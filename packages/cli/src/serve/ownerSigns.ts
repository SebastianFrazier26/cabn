/**
 * `cabn serve`'s owner routes for signs: create/overwrite and delete `.seyn`
 * files in the served folder, then update the in-memory bundle's signs.json
 * so a reload shows the change without restarting. Only the host page, which
 * carries the per-session owner token, can call these — see ownerAuth.ts for
 * the gate every request passes first. No shell, no other file types.
 * `realm: "shadow"` signs live in hidden folders and only ever update the
 * shadow realm's cached layer (ownerShadow.ts), never signs.json.
 */
import { unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	buildSignEntry,
	DEFAULT_IGNORES,
	isHiddenPath,
	type WorldBundle,
} from "@cabn/converter";
import {
	parseSignIndex,
	SEYN_EXTENSION,
	SEYN_MAX_BYTES,
	SIGN_INDEX_FILENAME,
	SIGN_INDEX_VERSION,
	type SignEntry,
	type SignIndexFile,
	type WorldManifest,
} from "@cabn/world-schema";
import { z } from "zod";
import {
	checkOwnerRequest,
	OwnerPathError,
	overwriteFileAtomic,
	readOwnerJson,
	resolveOwnerTarget,
} from "./ownerAuth.js";
import type { ShadowRealm } from "./ownerShadow.js";

export const OWNER_SIGNS_SAVE_ROUTE = "/owner/signs/save";
export const OWNER_SIGNS_DELETE_ROUTE = "/owner/signs/delete";

const IGNORED_SEGMENTS = new Set(DEFAULT_IGNORES);
const IGNORED_SEGMENTS_FOLDED = new Set(
	DEFAULT_IGNORES.map((s) => s.toLowerCase()),
);

/**
 * Stricter than ownerAuth's generic confinement: plain names only (the same
 * rule the engine's editor checks, systems/signs.ts isValidSignFileName), no
 * hidden folders (.git and friends), and nothing inside a folder the
 * converter ignores — a sign saved there would vanish on the next start.
 */
export function isAllowedSignPath(path: string): boolean {
	if (path.length === 0 || path.length > 512) return false;
	const segments = path.split("/");
	const file = segments.pop() ?? "";
	if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.seyn$/.test(file)) return false;
	return segments.every(
		(s) =>
			/^[A-Za-z0-9_][A-Za-z0-9._ -]{0,100}$/.test(s) &&
			!IGNORED_SEGMENTS.has(s),
	);
}

/**
 * The shadow realm's rule: the sign must sit in a hidden folder — that is
 * what makes it a shadow sign — but never in `.git` or a folder the
 * converter ignores (`.venv`, `node_modules`, ...), both case-folded for
 * case-insensitive file systems. The file name still starts with a letter
 * or digit.
 */
export function isAllowedShadowSignPath(path: string): boolean {
	if (path.length === 0 || path.length > 512) return false;
	const segments = path.split("/");
	const file = segments.pop() ?? "";
	if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.seyn$/.test(file)) return false;
	if (!segments.some((s) => s.startsWith("."))) return false;
	return segments.every(
		(s) =>
			/^[A-Za-z0-9_.][A-Za-z0-9._ -]{0,100}$/.test(s) &&
			s !== "." &&
			s !== ".." &&
			s.toLowerCase() !== ".git" &&
			!IGNORED_SEGMENTS_FOLDED.has(s.toLowerCase()),
	);
}

type Realm = "normal" | "shadow";

function signPathAllowed(path: string, realm: Realm | undefined): boolean {
	return realm === "shadow"
		? isAllowedShadowSignPath(path) && isHiddenPath(path)
		: isAllowedSignPath(path);
}

const RealmField = z.enum(["normal", "shadow"]).optional();

const SaveBodySchema = z
	.strictObject({
		path: z.string(),
		content: z.string(),
		create: z.boolean(),
		realm: RealmField,
	})
	.refine((b) => signPathAllowed(b.path, b.realm), {
		message: "not an allowed .seyn path",
	});

const DeleteBodySchema = z
	.strictObject({ path: z.string(), realm: RealmField })
	.refine((b) => signPathAllowed(b.path, b.realm), {
		message: "not an allowed .seyn path",
	});

export interface OwnerSignsContext {
	dir: string;
	port: number;
	ownerToken: string;
	bundle: WorldBundle;
	/** Owner mode's shadow realm; a `realm: "shadow"` request without one is refused. */
	shadow?: ShadowRealm;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}

function currentSigns(bundle: WorldBundle): SignEntry[] {
	const raw = bundle.get(SIGN_INDEX_FILENAME);
	if (typeof raw !== "string") return [];
	try {
		return parseSignIndex(JSON.parse(raw));
	} catch {
		return [];
	}
}

function writeSigns(bundle: WorldBundle, signs: SignEntry[]): void {
	const file: SignIndexFile = {
		signsVersion: SIGN_INDEX_VERSION,
		signs: [...signs].sort((a, b) =>
			a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
		),
	};
	bundle.set(SIGN_INDEX_FILENAME, JSON.stringify(file, null, 2));
}

function worldIndex(bundle: WorldBundle) {
	const raw = bundle.get("world.json");
	const manifest = (
		typeof raw === "string" ? JSON.parse(raw) : { clusters: [], portals: [] }
	) as Pick<WorldManifest, "clusters" | "portals">;
	return {
		portalIds: new Set(manifest.portals.map((p) => p.id)),
		clusters: manifest.clusters,
	};
}

/** Returns true when it handled the request (any owner-signs route); false for every other path, which the caller routes as before. */
export async function handleOwnerSignsRoute(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
	ctx: OwnerSignsContext,
): Promise<boolean> {
	if (
		pathname !== OWNER_SIGNS_SAVE_ROUTE &&
		pathname !== OWNER_SIGNS_DELETE_ROUTE
	)
		return false;
	const gate = checkOwnerRequest(req, {
		port: ctx.port,
		token: ctx.ownerToken,
	});
	if (!gate.ok) {
		sendJson(res, gate.status, { error: gate.reason });
		return true;
	}
	try {
		if (pathname === OWNER_SIGNS_SAVE_ROUTE) await save(req, res, ctx);
		else await remove(req, res, ctx);
	} catch (err) {
		if (err instanceof OwnerPathError) {
			sendJson(res, err.status, { error: err.message });
			return true;
		}
		// No absolute paths or stack in the response — the page only needs to know it failed.
		console.error("cabn serve: owner sign request failed", err);
		sendJson(res, 500, { error: "could not write the sign" });
	}
	return true;
}

async function save(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: OwnerSignsContext,
): Promise<void> {
	const body = await readOwnerJson(req, SaveBodySchema);
	if (!body.ok) {
		sendJson(res, body.status, { error: body.reason });
		return;
	}
	const { path, content, create, realm } = body.data;
	const shadow = realm === "shadow" ? ctx.shadow : undefined;
	if (realm === "shadow" && !shadow) {
		sendJson(res, 404, { error: "there is no shadow realm here" });
		return;
	}
	if (Buffer.byteLength(content, "utf8") > SEYN_MAX_BYTES) {
		sendJson(res, 413, { error: `a sign is at most ${SEYN_MAX_BYTES} bytes` });
		return;
	}
	const target = await resolveOwnerTarget(ctx.dir, path, {
		extension: SEYN_EXTENSION,
	});
	if (create && target.exists) {
		sendJson(res, 409, { error: `${path} already exists` });
		return;
	}
	if (!create && !target.exists) {
		sendJson(res, 404, { error: `${path} does not exist` });
		return;
	}
	if (create) {
		try {
			// wx: fails if anything (a file, a symlink, even a dangling one)
			// appeared at the path since resolveOwnerTarget looked.
			await writeFile(target.absolute, content, { flag: "wx", mode: 0o644 });
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST") {
				sendJson(res, 409, { error: `${path} already exists` });
				return;
			}
			throw err;
		}
	} else {
		await overwriteFileAtomic(target.absolute, content);
	}

	const entry = shadow
		? await shadow.putSign(path, content)
		: buildSignEntry(path, content, worldIndex(ctx.bundle))?.entry;
	if (!entry) {
		sendJson(res, 500, { error: "this world has nowhere to put a sign" });
		return;
	}
	if (!shadow)
		writeSigns(ctx.bundle, [
			...currentSigns(ctx.bundle).filter((s) => s.path !== path),
			entry,
		]);
	sendJson(res, 200, { sign: entry });
}

async function remove(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: OwnerSignsContext,
): Promise<void> {
	const body = await readOwnerJson(req, DeleteBodySchema);
	if (!body.ok) {
		sendJson(res, body.status, { error: body.reason });
		return;
	}
	const { path, realm } = body.data;
	const shadow = realm === "shadow" ? ctx.shadow : undefined;
	if (realm === "shadow" && !shadow) {
		sendJson(res, 404, { error: "there is no shadow realm here" });
		return;
	}
	const target = await resolveOwnerTarget(ctx.dir, path, {
		extension: SEYN_EXTENSION,
	});
	if (!target.exists) {
		sendJson(res, 404, { error: `${path} does not exist` });
		return;
	}
	await unlink(target.absolute);
	if (shadow) shadow.dropSign(path);
	else
		writeSigns(
			ctx.bundle,
			currentSigns(ctx.bundle).filter((s) => s.path !== path),
		);
	sendJson(res, 200, { ok: true });
}
