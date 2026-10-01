import {
	type PromiseFsClient,
	readBlob,
	readTree,
	type TreeEntry,
} from "isomorphic-git";
import type { FileSource, SourceEntry } from "../sources/types.js";
import { isIgnoredPath } from "../walk.js";

/**
 * Everything here reads git through isomorphic-git with an fs the host
 * injects, so the module stays free of node:* imports (the converter's
 * `./browser` rule) — the CLI passes node:fs, nothing else does.
 */
export interface GitHistoryInput {
	fs: PromiseFsClient;
	/** The directory the world is converted from. Absolute, "/"-separated. */
	dir: string;
	/**
	 * An explicit git directory. Otherwise `dir` itself must be the
	 * repository root: there is no upward search, so converting a folder
	 * that merely sits inside some larger repository (a home directory under
	 * version control, a monorepo) never publishes that repository's history.
	 */
	gitdir?: string;
}

export interface OpenedRepo {
	fs: PromiseFsClient;
	/** The working-tree root (where `.git` lives). */
	root: string;
	gitdir: string;
	/** Where the world sits inside the repository's trees; "" today (the world is the repo root), kept so every tree read already re-roots paths. */
	prefix: string;
	cache: object;
}

function trimSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export type OpenRepoResult =
	| { ok: true; repo: OpenedRepo }
	| { ok: false; reason: string };

export async function openGitRepo(
	input: GitHistoryInput,
): Promise<OpenRepoResult> {
	const dir = trimSlash(input.dir);
	if (input.gitdir) {
		return {
			ok: true,
			repo: {
				fs: input.fs,
				root: dir,
				gitdir: trimSlash(input.gitdir),
				prefix: "",
				cache: {},
			},
		};
	}
	const root = dir;
	const gitdir = `${root}/.git`;
	// lstat, and only a real directory: a `.git` symlink or a `gitdir:`
	// pointer file (worktrees, submodules) can name any repository on the
	// machine, and converting a folder must never publish history from
	// outside it. `--git-dir` is the explicit opt-in for those layouts.
	let stat: { isDirectory(): boolean; isSymbolicLink(): boolean };
	try {
		stat = await input.fs.promises.lstat(gitdir);
	} catch {
		return { ok: false, reason: "not a git repository root" };
	}
	if (stat.isSymbolicLink())
		return {
			ok: false,
			reason:
				".git is a symlink, which cabn doesn't follow; pass --git-dir to read that repository",
		};
	if (!stat.isDirectory())
		return {
			ok: false,
			reason:
				".git is a pointer file (a linked worktree or submodule), which cabn doesn't follow; pass --git-dir to read that repository",
		};
	const exists = async (path: string) =>
		input.fs.promises.stat(path).then(
			() => true,
			() => false,
		);
	if (!(await exists(`${gitdir}/HEAD`)))
		return { ok: false, reason: "unreadable git directory (.git has no HEAD)" };
	// isomorphic-git doesn't follow `commondir`, so a linked worktree's refs and objects are out of its reach.
	if (await exists(`${gitdir}/commondir`))
		return {
			ok: false,
			reason:
				"linked git worktrees aren't supported; build from the main checkout",
		};
	return {
		ok: true,
		repo: {
			fs: input.fs,
			root,
			gitdir,
			prefix: "",
			cache: {},
		},
	};
}

/**
 * Warnings and owner API errors reach a terminal or a page; an error raised
 * inside isomorphic-git can carry the repository's absolute paths, which
 * neither needs.
 */
export function redactRepoPaths(
	message: string,
	repo: { root: string; gitdir: string },
): string {
	let out = message.split(repo.gitdir).join("<git-dir>");
	if (repo.root.length > 1)
		out = out.split(`${repo.root}/`).join("").split(repo.root).join(".");
	return out;
}

export async function readTreeEntries(
	repo: OpenedRepo,
	oid: string,
): Promise<TreeEntry[]> {
	const { tree } = await readTree({
		fs: repo.fs,
		gitdir: repo.gitdir,
		oid,
		cache: repo.cache,
	});
	return tree;
}

/** The tree at `prefix` inside `rootTree`, or null when the world's directory didn't exist in that commit. */
export async function subtreeAt(
	repo: OpenedRepo,
	rootTree: string,
	prefix: string,
): Promise<string | null> {
	let oid = rootTree;
	if (!prefix) return oid;
	for (const segment of prefix.split("/")) {
		const entry = (await readTreeEntries(repo, oid)).find(
			(e) => e.path === segment,
		);
		if (entry?.type !== "tree") return null;
		oid = entry.oid;
	}
	return oid;
}

export async function readBlobBytes(
	repo: OpenedRepo,
	oid: string,
): Promise<Uint8Array> {
	const { blob } = await readBlob({
		fs: repo.fs,
		gitdir: repo.gitdir,
		oid,
		cache: repo.cache,
	});
	return blob;
}

/** Regular files only: symlinks (120000) would ship their target path, and gitlinks (160000) are other repositories. */
export function isRegularBlob(entry: TreeEntry): boolean {
	return (
		entry.type === "blob" &&
		(entry.mode === "100644" || entry.mode === "100755")
	);
}

export function looksBinary(bytes: Uint8Array): boolean {
	const limit = Math.min(bytes.length, 8000);
	for (let i = 0; i < limit; i++) if (bytes[i] === 0) return true;
	return false;
}

const decoder = new TextDecoder("utf-8", { fatal: false });
export function decodeText(bytes: Uint8Array): string {
	return decoder.decode(bytes);
}

/**
 * A commit's tree as a converter source — how a branch becomes a walkable
 * "universe" world, in the browser (over the world's git/ pack) or in Node.
 * It follows the main world's rules: walk() still keeps secret-pattern
 * files metadata-only. A blob the pack doesn't carry (secret-named, over
 * the blob cap, ignored — see gitPack.ts) is listed with its recorded size
 * but unreadable; `sealedPaths` (filled during the first entries() pass,
 * which convert()'s cabn.json lookup always makes before walk()) is what
 * convert() passes on so those render as sealed chests.
 */
export class GitTreeSource implements FileSource {
	readonly sealedPaths = new Set<string>();

	constructor(
		private readonly repo: OpenedRepo,
		private readonly treeOid: string,
		private readonly opts: {
			ignore: readonly string[];
			/** Sizes of blobs left out of the pack (git/meta.json `omitted`). */
			omittedSizes?: Readonly<Record<string, { size: number }>>;
		},
	) {}

	entries(): AsyncIterable<SourceEntry> {
		return this.walkTree(this.treeOid, "");
	}

	private async *walkTree(
		oid: string,
		base: string,
	): AsyncGenerator<SourceEntry> {
		for (const entry of await readTreeEntries(this.repo, oid)) {
			const path = base ? `${base}/${entry.path}` : entry.path;
			if (isIgnoredPath(path, this.opts.ignore)) continue;
			if (entry.type === "tree") {
				yield* this.walkTree(entry.oid, path);
				continue;
			}
			if (!isRegularBlob(entry)) continue;
			let bytes: Uint8Array;
			try {
				bytes = await readBlobBytes(this.repo, entry.oid);
			} catch {
				this.sealedPaths.add(path);
				yield {
					path,
					bytes: this.opts.omittedSizes?.[entry.oid]?.size ?? 0,
					read: () => Promise.resolve(undefined),
				};
				continue;
			}
			yield { path, bytes: bytes.length, read: () => Promise.resolve(bytes) };
		}
	}
}
