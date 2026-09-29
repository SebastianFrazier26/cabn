/**
 * `cabn serve --owner`'s shadow realm: the hidden files (dotfiles and
 * dot-folders) every normal world leaves out, served to the owner as a world
 * layer over the base world. The layer is computed lazily on the first
 * manifest request and cached here, in the serve process — it is never
 * written into the served bundle, so nothing hidden is ever reachable under
 * `/world/*`. Every route goes through ownerAuth.ts's gate and answers
 * `Cache-Control: no-store`; without `--owner` none of them exist.
 *
 * Edits save to disk only — never staged or committed — and only to hidden
 * text files that already exist; nothing here creates or deletes a file.
 */
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	buildSignEntry,
	convertShadow,
	DEFAULT_MAX_FILE_BYTES,
	DirSource,
	isHiddenPath,
	openGitRepo,
	type WorldBundle,
} from "@cabn/converter";
import type {
	SignEntry,
	WorldLayerDelta,
	WorldLayerManifest,
	WorldManifest,
} from "@cabn/world-schema";
import { listFiles } from "isomorphic-git";
import { z } from "zod";
import {
	checkOwnerRequest,
	OwnerPathError,
	overwriteFileAtomic,
	readOwnerJson,
	resolveExistingOwnerFile,
	sendOwnerJson,
} from "./ownerAuth.js";

export const OWNER_SHADOW_ROUTES = {
	manifest: "/owner/shadow/manifest",
	searchIndex: "/owner/shadow/search-index",
	save: "/owner/shadow/save",
	/** Followed by the URL-encoded cluster id. */
	chunkPrefix: "/owner/shadow/chunk/",
} as const;

/** A save carries one whole file, so it gets more room than the shared 128 KB default. */
const OWNER_SHADOW_SAVE_MAX_BYTES = 2 * 1024 * 1024;

export const ShadowSaveBodySchema = z.strictObject({
	path: z.string().min(1).max(512),
	content: z.string(),
	baseSha256: z.string().regex(/^[0-9a-f]{64}$/, "not a sha256 hex digest"),
});

export interface ShadowRealmOptions {
	dir: string;
	/** `--git-dir`, when given. */
	gitdir?: string;
	/** The currently served bundle (replaced wholesale on reconvert). */
	bundle(): WorldBundle;
}

function sha256Hex(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export class ShadowRealm {
	private cached: WorldLayerDelta | undefined;
	private pending: Promise<WorldLayerDelta> | undefined;
	// Bumped by clear(): a computation that started before a reconvert must
	// not be cached after it.
	private generation = 0;

	constructor(private readonly opts: ShadowRealmOptions) {}

	baseManifest(): WorldManifest {
		const raw = this.opts.bundle().get("world.json");
		if (typeof raw !== "string") throw new Error("no world.json to extend");
		return JSON.parse(raw) as WorldManifest;
	}

	/** Forgets the layer; the next request recomputes it. Called on every reconvert. */
	clear(): void {
		this.generation++;
		this.cached = undefined;
		this.pending = undefined;
	}

	/** The cached layer, if it still matches the served base world. */
	peek(): WorldLayerDelta | undefined {
		const base = this.baseManifest();
		return this.cached?.baseGeneratedAt === base.meta.generatedAt
			? this.cached
			: undefined;
	}

	async delta(): Promise<WorldLayerDelta> {
		const fresh = this.peek();
		if (fresh) return fresh;
		if (this.pending) return this.pending;
		const generation = this.generation;
		const base = this.baseManifest();
		const work = (async () => {
			const repo = await this.repo();
			const delta = await convertShadow(new DirSource(this.opts.dir), base, {
				trackedPaths: repo.tracked,
			});
			if (generation === this.generation) this.cached = delta;
			return delta;
		})();
		this.pending = work;
		try {
			return await work;
		} finally {
			if (this.pending === work) this.pending = undefined;
		}
	}

	/** The git directory (for the not-in-gitdir check) and the paths git tracks (magpies on secret-named hidden files). No repository: neither. */
	async repo(): Promise<{ gitdir?: string; tracked: Set<string> }> {
		const opened = await openGitRepo({
			fs: nodeFs,
			dir: this.opts.dir,
			...(this.opts.gitdir ? { gitdir: this.opts.gitdir } : {}),
		});
		if (!opened.ok) return { tracked: new Set() };
		const { root, gitdir } = opened.repo;
		try {
			const files = await listFiles({ fs: nodeFs, dir: root, gitdir });
			return { gitdir, tracked: new Set(files) };
		} catch {
			return { gitdir, tracked: new Set() };
		}
	}

	/** A shadow sign was written: resolve its anchor against base ∪ layer and put it in the cached layer only. */
	async putSign(path: string, content: string): Promise<SignEntry | null> {
		const delta = await this.delta();
		const base = this.baseManifest();
		const built = buildSignEntry(path, content, {
			portalIds: new Set([
				...base.portals.map((p) => p.id),
				...delta.portals.map((p) => p.id),
			]),
			clusters: [...base.clusters, ...delta.clusters],
		});
		if (!built) return null;
		delta.signs = [
			...delta.signs.filter((s) => s.path !== path),
			built.entry,
		].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return built.entry;
	}

	dropSign(path: string): void {
		if (this.cached)
			this.cached.signs = this.cached.signs.filter((s) => s.path !== path);
	}
}

export interface OwnerShadowContext {
	dir: string;
	port(): number;
	ownerToken: string;
	shadow: ShadowRealm;
}

class ShadowRouteError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly extra: Record<string, unknown> = {},
	) {
		super(message);
	}
}

let queue: Promise<unknown> = Promise.resolve();
// One save at a time: the hash check and the write must not interleave with another save.
function serialized<T>(work: () => Promise<T>): Promise<T> {
	const next = queue.then(work, work);
	queue = next.catch(() => undefined);
	return next;
}

function layerManifest(delta: WorldLayerDelta): WorldLayerManifest {
	const { chunks: _chunks, searchIndex: _searchIndex, ...manifest } = delta;
	return manifest;
}

function chunkIdFrom(pathname: string): string {
	let id: string;
	try {
		id = decodeURIComponent(
			pathname.slice(OWNER_SHADOW_ROUTES.chunkPrefix.length),
		);
	} catch {
		throw new ShadowRouteError(400, "malformed cluster id");
	}
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
	if (id.length === 0 || id.length > 512 || /[\u0000-\u001F\u007F]/.test(id))
		throw new ShadowRouteError(400, "malformed cluster id");
	return id;
}

async function saveHiddenFile(
	ctx: OwnerShadowContext,
	body: z.infer<typeof ShadowSaveBodySchema>,
): Promise<{ path: string; sha256: string }> {
	const { path, content, baseSha256 } = body;
	if (Buffer.byteLength(content, "utf8") > DEFAULT_MAX_FILE_BYTES)
		throw new ShadowRouteError(
			413,
			`a file is at most ${DEFAULT_MAX_FILE_BYTES} bytes`,
		);
	const delta = await ctx.shadow.delta();
	if (!Object.hasOwn(delta.textSha256, path) || !isHiddenPath(path))
		throw new ShadowRouteError(
			403,
			`"${path}" is not a hidden text file in the shadow realm`,
		);
	const { gitdir } = await ctx.shadow.repo();
	const real = await resolveExistingOwnerFile(ctx.dir, path, gitdir);
	const current = sha256Hex(await readFile(real));
	if (current !== baseSha256) {
		// The cached layer holds the old text too: without this a
		// "reload from disk" would be served the same stale copy.
		ctx.shadow.clear();
		throw new ShadowRouteError(
			409,
			`"${path}" changed on disk since it was loaded; reload the shadow realm`,
			{ currentSha256: current },
		);
	}
	await overwriteFileAtomic(real, content);
	// Contents, previews and monsters all changed: recompute on next request.
	ctx.shadow.clear();
	return { path, sha256: sha256Hex(content) };
}

/** Returns false when the path isn't a shadow route (the caller 404s). */
export async function handleOwnerShadow(
	req: IncomingMessage,
	res: ServerResponse,
	pathname: string,
	ctx: OwnerShadowContext,
): Promise<boolean> {
	const isChunk = pathname.startsWith(OWNER_SHADOW_ROUTES.chunkPrefix);
	const route = isChunk
		? "chunk"
		: pathname === OWNER_SHADOW_ROUTES.manifest
			? "manifest"
			: pathname === OWNER_SHADOW_ROUTES.searchIndex
				? "searchIndex"
				: pathname === OWNER_SHADOW_ROUTES.save
					? "save"
					: undefined;
	if (!route) return false;
	const gate = checkOwnerRequest(req, {
		port: ctx.port(),
		token: ctx.ownerToken,
		method: route === "save" ? "POST" : "GET",
	});
	if (!gate.ok) {
		sendOwnerJson(res, gate.status, { error: gate.reason });
		return true;
	}
	try {
		if (route === "manifest") {
			sendOwnerJson(res, 200, layerManifest(await ctx.shadow.delta()));
		} else if (route === "searchIndex") {
			sendOwnerJson(res, 200, (await ctx.shadow.delta()).searchIndex);
		} else if (route === "chunk") {
			const id = chunkIdFrom(pathname);
			const delta = await ctx.shadow.delta();
			if (!Object.hasOwn(delta.chunks, id))
				throw new ShadowRouteError(404, "no such shadow cluster");
			sendOwnerJson(res, 200, delta.chunks[id]);
		} else {
			const body = await readOwnerJson(
				req,
				ShadowSaveBodySchema,
				OWNER_SHADOW_SAVE_MAX_BYTES,
			);
			if (!body.ok) {
				sendOwnerJson(res, body.status, { error: body.reason });
				return true;
			}
			const data = body.data;
			sendOwnerJson(
				res,
				200,
				await serialized(() => saveHiddenFile(ctx, data)),
			);
		}
	} catch (err) {
		if (err instanceof ShadowRouteError) {
			sendOwnerJson(res, err.status, { error: err.message, ...err.extra });
		} else if (err instanceof OwnerPathError) {
			sendOwnerJson(res, err.status, { error: err.message });
		} else {
			// Name and code only: a message could quote file contents.
			const e = err as NodeJS.ErrnoException;
			console.error(
				`cabn serve: owner shadow request failed (${e?.name ?? "Error"}${e?.code ? ` ${e.code}` : ""})`,
			);
			sendOwnerJson(res, 500, { error: "shadow realm request failed" });
		}
	}
	return true;
}
