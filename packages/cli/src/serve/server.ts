import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { basename, extname, posix, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import {
	convert,
	DirSource,
	type GithubFetch,
	type WorldBundle,
} from "@cabn/converter";
import { cliEmbedNetwork, cliGitInput } from "../build.js";
import {
	DEFAULT_OUTPUT_CAP_BYTES,
	DEFAULT_TIMEOUT_MS,
	type ExecEvent,
	runScript,
} from "./execRunner.js";
import { bundleHostApp, hostPageHtml } from "./hostPage.js";
import { generateOwnerToken } from "./ownerAuth.js";
import { handleOwnerGit, type OwnerGitContext } from "./ownerGit.js";
import { handleOwnerShadow, ShadowRealm } from "./ownerShadow.js";
import { handleOwnerSignsRoute } from "./ownerSigns.js";
import { runtimeForPath } from "./runtime.js";
import {
	constantTimeEqual,
	frameSrcPolicy,
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
	/** Skip the build-time framability check for url previews and the GitHub releases request. */
	offline?: boolean;
	/**
	 * Owner mode (`--owner`, off by default, loopback only like
	 * --allow-exec): one per-session owner token, and the token-gated owner
	 * routes — signs (`/owner/signs/*`: write/delete .seyn files) and git
	 * (`/owner/git/*`: commit in-game edits, create/switch branches in the
	 * real repository, never push or fetch). Off, neither route group exists
	 * and the host page carries no owner client.
	 */
	owner?: boolean;
	/** false: serve without git history (`--no-history`). */
	history?: boolean;
	gitDir?: string;
	/** Tests only: replaces the GitHub releases fetch. */
	githubFetch?: GithubFetch;
}

export interface ServeHandle {
	server: Server;
	url: string;
	token: string;
	/** Undefined with owner mode off. Never printed — it lives only in the host page. */
	ownerToken: string | undefined;
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

// pdf.js's worker, resolved through @cabn/engine (whose exact-pinned
// pdfjs-dist it must match) and served from this same loopback origin — the
// host page never loads it from a CDN.
export const PDF_WORKER_ROUTE = "/pdfjs/pdf.worker.min.mjs";
function resolvePdfWorkerPath(): string | undefined {
	try {
		const enginePath = fileURLToPath(import.meta.resolve("@cabn/engine"));
		return createRequire(enginePath).resolve(
			"pdfjs-dist/build/pdf.worker.min.mjs",
		);
	} catch {
		return undefined;
	}
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".gif": "image/gif",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".pdf": "application/pdf",
};

function contentTypeFor(path: string): string {
	const ext = extname(path).toLowerCase();
	if (ext === ".json") return "application/json; charset=utf-8";
	if (ext === ".webp") return "image/webp";
	if (ext === ".png") return "image/png";
	const media = MEDIA_CONTENT_TYPES[ext];
	if (media) return media;
	if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
	if (ext === ".html") return "text/html; charset=utf-8";
	return "application/octet-stream";
}

interface ServeContext {
	dir: string;
	host: string;
	port: number;
	token: string;
	ownerToken: string | undefined;
	allowExec: boolean;
	bundle: WorldBundle;
	hostAppJs: string;
	html: string;
	csp: string;
	timeoutMs: number | undefined;
	outputCapBytes: number | undefined;
	owner: OwnerGitContext | undefined;
	/** Owner mode only: the lazily computed, never-bundled layer of hidden files. */
	shadow: ShadowRealm | undefined;
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

/** `shadow/...` under the asset root, however spelled (case-insensitive filesystems, `./`, doubled slashes). */
export function isShadowAssetPath(relPath: string): boolean {
	const first = posix
		.normalize(relPath)
		.split("/")
		.find((s) => s !== "" && s !== ".");
	return first?.toLowerCase() === "shadow";
}

// What the engine loads from /assets/: images, plus room for audio and fonts.
// Anything else in those trees (the UI mockup's .html, manifests, notes) would
// otherwise be served from this origin, html as a live page beside the token.
const REPO_ASSET_TYPES: Record<string, string> = {
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

// The host page carries the session token and drives owner writes, so no
// other page may frame it (clickjacking). Only cabn serve's own page; the
// demo and hosted builds set their own headers.
function hostPagePolicy(frameSrc: string): string {
	return `${frameSrc}; frame-ancestors 'none'`;
}

async function serveRepoAsset(
	res: ServerResponse,
	relPath: string,
): Promise<void> {
	const contentType = REPO_ASSET_TYPES[extname(relPath).toLowerCase()];
	if (!contentType) {
		res.writeHead(404);
		res.end("not found");
		return;
	}
	// Bundled dist/assets checked first so a published install wins even if
	// this happens to also be running inside the monorepo checkout.
	for (const base of [BUNDLED_ASSETS_DIR, REPO_ASSETS_DIR]) {
		try {
			const real = await resolveConfinedPath(base, relPath);
			// A symlinked name mustn't relabel some other file type.
			if (REPO_ASSET_TYPES[extname(real).toLowerCase()] !== contentType)
				continue;
			const data = await readFile(real);
			res.writeHead(200, { "content-type": contentType });
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

function isPageTokenValid(url: URL, ctx: Pick<ServeContext, "token">): boolean {
	const presented = url.searchParams.get("token");
	return presented !== null && constantTimeEqual(presented, ctx.token);
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
		// Host/Origin alone don't stop another local process from reading the
		// page and lifting both tokens out of it; only whoever saw the printed
		// URL gets it. 404 rather than 403, as for the absent routes below.
		if (!isPageTokenValid(url, ctx)) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		// The page embeds the session token in a <script> — never cacheable,
		// including by an intermediary that might otherwise serve it back to a
		// different origin's request.
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": hostPagePolicy(ctx.csp),
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
		const rel = url.pathname.slice("/assets/".length);
		// The shadow realm's art exists only for the owner, like its routes.
		if (!ctx.ownerToken && isShadowAssetPath(rel)) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		await serveRepoAsset(res, rel);
		return;
	}
	if (req.method === "GET" && url.pathname === PDF_WORKER_ROUTE) {
		const workerPath = resolvePdfWorkerPath();
		if (workerPath) {
			res.writeHead(200, { "content-type": contentTypeFor(workerPath) });
			res.end(await readFile(workerPath));
			return;
		}
	}
	// Registered only when --allow-exec was passed at all — with it absent,
	// this falls through to the generic 404 below exactly as if the route
	// never existed, not a 403 that would confirm the capability is merely
	// gated rather than genuinely absent.
	if (req.method === "POST" && url.pathname === "/exec" && ctx.allowExec) {
		await handleExec(req, res, ctx);
		return;
	}
	// Same "absent, not forbidden" rule as /exec: without --owner these routes don't exist.
	if (ctx.ownerToken && url.pathname.startsWith("/owner/")) {
		const handled =
			(ctx.owner &&
				(await handleOwnerGit(req, res, url.pathname, ctx.owner))) ||
			(ctx.shadow &&
				(await handleOwnerShadow(req, res, url.pathname, {
					dir: ctx.dir,
					port: () => ctx.port,
					ownerToken: ctx.ownerToken,
					shadow: ctx.shadow,
				}))) ||
			(await handleOwnerSignsRoute(req, res, url.pathname, {
				dir: ctx.dir,
				port: ctx.port,
				ownerToken: ctx.ownerToken,
				bundle: ctx.bundle,
				...(ctx.shadow ? { shadow: ctx.shadow } : {}),
			}));
		if (handled) return;
	}

	res.writeHead(404);
	res.end("not found");
}

/** Top-level chunks only (universes/ has its own): the text each world portal was converted from. */
export function worldTextFromBundle(bundle: WorldBundle): Map<string, string> {
	const text = new Map<string, string>();
	for (const [key, value] of bundle) {
		if (!key.startsWith("chunks/") || typeof value !== "string") continue;
		const chunk = JSON.parse(value) as {
			files?: Record<string, { content?: unknown }>;
		};
		for (const [path, file] of Object.entries(chunk.files ?? {})) {
			if (typeof file.content === "string") text.set(path, file.content);
		}
	}
	return text;
}

function worldEmbedOrigins(bundle: WorldBundle): unknown[] {
	const raw = bundle.get("world.json");
	if (typeof raw !== "string") return [];
	const origins = (JSON.parse(raw) as { allowedEmbedOrigins?: unknown })
		.allowedEmbedOrigins;
	return Array.isArray(origins) ? origins : [];
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
	if (opts.owner && host !== "127.0.0.1") {
		throw new Error(
			`cabn serve --owner refuses a non-loopback host ("${host}") — repository writes are only ever offered on 127.0.0.1.`,
		);
	}

	const resolvedDir = resolvePath(dir);
	const token = randomBytes(32).toString("hex");
	const convertWorld = () =>
		convert(new DirSource(resolvedDir), {
			name: basename(resolvedDir),
			source: resolvedDir,
			embedNetwork: cliEmbedNetwork(opts.offline),
			git: cliGitInput(resolvedDir, opts),
			onWarning: (message) => console.warn(`cabn serve: ${message}`),
		});
	const bundle = await convertWorld();
	const ownerToken = opts.owner ? generateOwnerToken() : undefined;
	const hostAppJs = await bundleHostApp({
		token,
		allowExec,
		owner: ownerToken !== undefined,
	});
	const html = hostPageHtml(token, ownerToken);

	const ctx: ServeContext = {
		dir: resolvedDir,
		host,
		port,
		token,
		ownerToken,
		allowExec,
		bundle,
		hostAppJs,
		html,
		csp: frameSrcPolicy(worldEmbedOrigins(bundle)),
		timeoutMs: opts.timeoutMs,
		outputCapBytes: opts.outputCapBytes,
		owner: undefined,
		shadow: undefined,
	};
	let worldText = worldTextFromBundle(bundle);
	if (ownerToken) {
		ctx.shadow = new ShadowRealm({
			dir: resolvedDir,
			...(opts.gitDir ? { gitdir: resolvePath(opts.gitDir) } : {}),
			bundle: () => ctx.bundle,
		});
		ctx.owner = {
			dir: resolvedDir,
			...(opts.gitDir ? { gitdir: resolvePath(opts.gitDir) } : {}),
			port: () => ctx.port,
			ownerToken,
			worldText: () => worldText,
			reconvert: async () => {
				const next = await convertWorld();
				ctx.bundle = next;
				ctx.csp = frameSrcPolicy(worldEmbedOrigins(next));
				worldText = worldTextFromBundle(next);
				ctx.shadow?.clear();
			},
		};
	}

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
	if (ownerToken) {
		console.log(
			`\u001b[33mOwner mode: this page can edit signs, commit edits and create/switch branches in ${resolvedDir} (never push or fetch).\u001b[0m`,
		);
	}
	console.log(`cabn serve: ${url}`);

	return {
		server,
		url,
		token,
		ownerToken,
		port: ctx.port,
		close: () =>
			new Promise((resolveClose) => {
				server.close(() => resolveClose());
			}),
	};
}
