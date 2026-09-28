import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { basename, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { convert, DirSource, type WorldBundle } from "@cabn/converter";
import {
	DEFAULT_OUTPUT_CAP_BYTES,
	DEFAULT_TIMEOUT_MS,
	type ExecEvent,
	runScript,
} from "./execRunner.js";
import { bundleHostApp, hostPageHtml } from "./hostPage.js";
import { runtimeForPath } from "./runtime.js";
import {
	constantTimeEqual,
	isAllowedOrigin,
	isLoopbackHost,
	PathConfinementError,
	resolveConfinedPath,
} from "./security.js";

export interface ServeOptions {
	port?: number;
	/** Deliberately not exposed as a real CLI flag — see the refusal check below. Only present so tests can exercise the "refuses a non-loopback host" path without a fake --host flag existing in the CLI's own argv parsing. */
	host?: string;
	allowExec?: boolean;
	timeoutMs?: number;
	outputCapBytes?: number;
}

export interface ServeHandle {
	server: Server;
	url: string;
	token: string;
	port: number;
	close(): Promise<void>;
}

export const DEFAULT_SERVE_PORT = 5178;

// A published @cabn/cli has scripts/copy-assets.mjs bundle the fixed sprite
// subset `cabn serve` actually uses into dist/assets at build time (dist/
// serve/server.js -> dist/assets) — this is what makes sprites work via
// `npx @cabn/cli serve` outside this monorepo.
const BUNDLED_ASSETS_DIR = resolvePath(
	fileURLToPath(import.meta.url),
	"../../assets",
);

// Falls back to this monorepo's own assets/generated/ (packages/cli/dist/
// serve/server.js -> repo root), same "hardcoded relative walk" apps/demo's
// build-world.mjs already does — covers running from source before a build
// (no dist/assets yet) and any sprite copy-assets.mjs doesn't bundle (e.g.
// art still on a parallel branch — see serveRepoAsset below).
const REPO_ASSETS_DIR = resolvePath(
	fileURLToPath(import.meta.url),
	"../../../../../assets/generated",
);

function contentTypeFor(path: string): string {
	const ext = extname(path).toLowerCase();
	if (ext === ".json") return "application/json; charset=utf-8";
	if (ext === ".webp") return "image/webp";
	if (ext === ".png") return "image/png";
	if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
	if (ext === ".html") return "text/html; charset=utf-8";
	return "application/octet-stream";
}

interface ServeContext {
	dir: string;
	host: string;
	port: number;
	token: string;
	allowExec: boolean;
	bundle: WorldBundle;
	hostAppJs: string;
	html: string;
	timeoutMs: number | undefined;
	outputCapBytes: number | undefined;
}

async function readJsonBody(
	req: IncomingMessage,
	maxBytes = 8 * 1024,
): Promise<unknown> {
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of req) {
		total += (chunk as Buffer).length;
		if (total > maxBytes) throw new Error("request body too large");
		chunks.push(chunk as Buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return text ? JSON.parse(text) : {};
}

function serveWorldAsset(
	res: ServerResponse,
	bundle: WorldBundle,
	key: string,
): void {
	const value = bundle.get(key);
	if (value === undefined) {
		res.writeHead(404);
		res.end("not found");
		return;
	}
	res.writeHead(200, { "content-type": contentTypeFor(key) });
	res.end(value);
}

async function serveRepoAsset(
	res: ServerResponse,
	relPath: string,
): Promise<void> {
	// Bundled dist/assets checked first so a published install wins even if
	// this happens to also be running inside the monorepo checkout.
	for (const base of [BUNDLED_ASSETS_DIR, REPO_ASSETS_DIR]) {
		try {
			const real = await resolveConfinedPath(base, relPath);
			const data = await readFile(real);
			res.writeHead(200, { "content-type": contentTypeFor(real) });
			res.end(data);
			return;
		} catch {
			// try the next candidate
		}
	}
	// Best-effort: neither location has this sprite — the engine's own
	// PreloadScene already falls back to tinted placeholders for any sprite
	// that 404s, so this degrades rather than breaks.
	res.writeHead(404);
	res.end("not found");
}

/**
 * Every request's gate, checked before any routing (see handleRequest) — not
 * just /exec. A GET on `/`, `/app.js`, `/world/*`, or `/assets/*` answered
 * over a rebound hostname would hand a hostile page the full world bundle
 * (source code, via world.json + its chunks) and the session token embedded
 * in the host page HTML; the token then being exec-only-checked would be
 * defense-in-depth against the wrong threat. Host is checked unconditionally;
 * Origin only when the request actually carries one (most non-browser
 * clients never send it, and a same-origin navigation to `/` won't either).
 */
function isRequestFromLoopback(
	req: IncomingMessage,
	ctx: Pick<ServeContext, "port">,
): { ok: true } | { ok: false; reason: string } {
	if (!isLoopbackHost(req.headers.host, ctx.port)) {
		return { ok: false, reason: "invalid host" };
	}
	const origin = req.headers.origin;
	if (
		origin !== undefined &&
		!isAllowedOrigin(Array.isArray(origin) ? origin[0] : origin, ctx.port)
	) {
		return { ok: false, reason: "invalid origin" };
	}
	return { ok: true };
}

/** Token check only — Host/Origin are already gated for every request by isRequestFromLoopback before handleRequest ever routes here. */
function isExecTokenValid(
	req: IncomingMessage,
	ctx: Pick<ServeContext, "token">,
): boolean {
	const tokenHeader = req.headers["x-cabn-token"];
	const presented = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
	return (
		Boolean(presented) && constantTimeEqual(presented as string, ctx.token)
	);
}

async function handleExec(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: ServeContext,
): Promise<void> {
	if (!isExecTokenValid(req, ctx)) {
		res.writeHead(403, { "content-type": "text/plain" });
		res.end("invalid token");
		return;
	}

	let body: unknown;
	try {
		body = await readJsonBody(req);
	} catch {
		res.writeHead(400);
		res.end("invalid request body");
		return;
	}
	const relPath =
		typeof body === "object" && body !== null && "path" in body
			? (body as { path: unknown }).path
			: undefined;
	if (typeof relPath !== "string") {
		res.writeHead(400);
		res.end('expected { "path": string }');
		return;
	}

	let absolutePath: string;
	try {
		absolutePath = await resolveConfinedPath(ctx.dir, relPath);
	} catch (err) {
		if (err instanceof PathConfinementError) {
			res.writeHead(403);
			res.end("path is outside the served directory");
			return;
		}
		throw err;
	}

	const runtime = runtimeForPath(absolutePath);
	if (!runtime) {
		res.writeHead(400);
		res.end("unsupported file extension");
		return;
	}

	res.writeHead(200, {
		"content-type": "application/x-ndjson; charset=utf-8",
		"cache-control": "no-store",
	});

	const running = runScript(runtime.command, runtime.buildArgs(absolutePath), {
		cwd: ctx.dir,
		traced: runtime.traced,
		timeoutMs: ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		outputCapBytes: ctx.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES,
		onEvent: (event: ExecEvent) => {
			if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
		},
	});

	const onDisconnect = (): void => running.kill("SIGKILL");
	req.once("close", onDisconnect);
	res.once("close", onDisconnect);

	await running.done;
	req.off("close", onDisconnect);
	res.off("close", onDisconnect);
	if (!res.writableEnded) res.end();
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: ServeContext,
): Promise<void> {
	// Applied to every response regardless of route or outcome — nosniff and
	// no-referrer cost nothing on a 403/404 either, and the token lives in
	// both the page HTML and the printed URL's query string, so no-referrer
	// matters even off the "/" route (an asset load from the host page is
	// still a request "from" a page whose URL contains the token).
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");

	const loopback = isRequestFromLoopback(req, ctx);
	if (!loopback.ok) {
		res.writeHead(403, { "content-type": "text/plain" });
		res.end(loopback.reason);
		return;
	}

	const url = new URL(req.url ?? "/", `http://${ctx.host}:${ctx.port}`);

	if (req.method === "GET" && url.pathname === "/") {
		// The page embeds the session token in a <script> — never cacheable,
		// including by an intermediary that might otherwise serve it back to a
		// different origin's request.
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
		});
		res.end(ctx.html);
		return;
	}
	if (req.method === "GET" && url.pathname === "/app.js") {
		res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
		res.end(ctx.hostAppJs);
		return;
	}
	if (req.method === "GET" && url.pathname.startsWith("/world/")) {
		serveWorldAsset(res, ctx.bundle, url.pathname.slice("/world/".length));
		return;
	}
	if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
		await serveRepoAsset(res, url.pathname.slice("/assets/".length));
		return;
	}
	// Registered only when --allow-exec was passed at all — with it absent,
	// this falls through to the generic 404 below exactly as if the route
	// never existed, not a 403 that would confirm the capability is merely
	// gated rather than genuinely absent.
	if (req.method === "POST" && url.pathname === "/exec" && ctx.allowExec) {
		await handleExec(req, res, ctx);
		return;
	}

	res.writeHead(404);
	res.end("not found");
}

/**
 * Converts `dir` in memory and starts serving it — binds to 127.0.0.1 only
 * (never configurable to 0.0.0.0 from the CLI surface; `opts.host` exists
 * solely so tests can exercise the refusal path below without a real
 * flag). See handleExec/isExecRequestAuthorized for the exec endpoint's own
 * gate, and REPO_ASSETS_DIR's doc for why sprites are best-effort outside
 * this monorepo.
 */
export async function startServe(
	dir: string,
	opts: ServeOptions = {},
): Promise<ServeHandle> {
	const host = opts.host ?? "127.0.0.1";
	const port = opts.port ?? DEFAULT_SERVE_PORT;
	const allowExec = opts.allowExec ?? false;

	if (allowExec && host !== "127.0.0.1") {
		throw new Error(
			`cabn serve --allow-exec refuses a non-loopback host ("${host}") — real code execution is only ever offered on 127.0.0.1.`,
		);
	}

	const resolvedDir = resolvePath(dir);
	const token = randomBytes(32).toString("hex");
	const bundle = await convert(new DirSource(resolvedDir), {
		name: basename(resolvedDir),
		source: resolvedDir,
	});
	const hostAppJs = await bundleHostApp({ token, allowExec });
	const html = hostPageHtml(token);

	const ctx: ServeContext = {
		dir: resolvedDir,
		host,
		port,
		token,
		allowExec,
		bundle,
		hostAppJs,
		html,
		timeoutMs: opts.timeoutMs,
		outputCapBytes: opts.outputCapBytes,
	};

	const server = createServer((req, res) => {
		handleRequest(req, res, ctx).catch((err: unknown) => {
			if (!res.writableEnded) {
				res.writeHead(500);
				res.end("internal error");
			}
			console.error("cabn serve: request handler error", err);
		});
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(port, host, () => resolveListen());
	});
	// `port: 0` (tests only — never a real CLI flag value) asks the OS for an
	// ephemeral port; ctx.port must reflect whatever it actually picked, since
	// every Host/Origin check below compares against it.
	const boundAddress = server.address();
	if (boundAddress && typeof boundAddress === "object") {
		ctx.port = boundAddress.port;
	}

	const url = `http://${host}:${ctx.port}/?token=${token}`;
	if (allowExec) {
		console.log(
			`\n\u001b[31m\u001b[1mREAL CODE EXECUTION ENABLED for ${resolvedDir} — only use with code you trust.\u001b[0m\n`,
		);
	}
	console.log(`cabn serve: ${url}`);

	return {
		server,
		url,
		token,
		port: ctx.port,
		close: () =>
			new Promise((resolveClose) => {
				server.close(() => resolveClose());
			}),
	};
}
