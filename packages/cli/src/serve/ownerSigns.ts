/**
 * `cabn serve`'s owner routes for signs: create/overwrite and delete `.seyn`
 * files in the served folder, then update the in-memory bundle's signs.json
 * so a reload shows the change without restarting. Only the host page, which
 * carries the per-session owner token, can call these — see ownerAuth.ts for
 * the gate every request passes first. No shell, no other file types.
 */
import { randomBytes } from "node:crypto";
import { rename, rm, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import {
	buildSignEntry,
	DEFAULT_IGNORES,
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
	readOwnerJson,
	resolveOwnerTarget,
} from "./ownerAuth.js";

export const OWNER_SIGNS_SAVE_ROUTE = "/owner/signs/save";
export const OWNER_SIGNS_DELETE_ROUTE = "/owner/signs/delete";

const IGNORED_SEGMENTS = new Set(DEFAULT_IGNORES);

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

const SignPathField = z
	.string()
	.refine(isAllowedSignPath, { message: "not an allowed .seyn path" });

const SaveBodySchema = z.strictObject({
	path: SignPathField,
	content: z.string(),
	create: z.boolean(),
});

const DeleteBodySchema = z.strictObject({ path: SignPathField });

export interface OwnerSignsContext {
	dir: string;
	port: number;
	ownerToken: string;
	bundle: WorldBundle;
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

/** Write to a fresh temp file beside the target, then rename over it: a reader never sees half a sign, and rename replaces the directory entry itself rather than following whatever it points at. */
async function overwriteFile(target: string, content: string): Promise<void> {
	const temp = join(
		dirname(target),
		`.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
	);
	try {
		await writeFile(temp, content, { flag: "wx", mode: 0o644 });
		await rename(temp, target);
	} catch (err) {
		await rm(temp, { force: true });
		throw err;
	}
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
	const { path, content, create } = body.data;
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
		await overwriteFile(target.absolute, content);
	}

	const built = buildSignEntry(path, content, worldIndex(ctx.bundle));
	if (!built) {
		sendJson(res, 500, { error: "this world has nowhere to put a sign" });
		return;
	}
	writeSigns(ctx.bundle, [
		...currentSigns(ctx.bundle).filter((s) => s.path !== path),
		built.entry,
	]);
	sendJson(res, 200, { sign: built.entry });
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
	const { path } = body.data;
	const target = await resolveOwnerTarget(ctx.dir, path, {
		extension: SEYN_EXTENSION,
	});
	if (!target.exists) {
		sendJson(res, 404, { error: `${path} does not exist` });
		return;
	}
	await unlink(target.absolute);
	writeSigns(
		ctx.bundle,
		currentSigns(ctx.bundle).filter((s) => s.path !== path),
	);
	sendJson(res, 200, { ok: true });
}
