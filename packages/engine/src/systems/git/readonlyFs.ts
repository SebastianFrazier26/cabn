/**
 * The file system isomorphic-git sees in the browser: the world's shipped
 * git/ directory, read over fetch, and nothing else. Read-only (every write
 * fails with EROFS), and a read only ever fetches a path listed in
 * git/files.json — which the schema already pins to HEAD, config,
 * packed-refs, shallow and the one pack + index — so no git call, whatever
 * path it builds, can make the page fetch anything outside `<world>/git/`.
 */
export const VIRTUAL_GITDIR = "/git";

export interface ReadonlyGitFsOptions {
	/** `<world base>git/` — where the listed files are served. */
	baseUrl: string;
	/** git/files.json `files`, relative to git/. */
	files: readonly string[];
	/** Maps a full url to a loadable one (memory worlds); defaults to identity. */
	resolve?: (url: string) => string;
	fetch?: (
		url: string,
	) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
}

class FsError extends Error {
	constructor(
		readonly code: string,
		path: string,
	) {
		super(`${code}: ${path}`);
	}
}

interface Stat {
	type: "file" | "dir";
	mode: number;
	size: number;
	ino: number;
	mtimeMs: number;
	ctimeMs: number;
	uid: number;
	gid: number;
	dev: number;
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

function statOf(type: "file" | "dir", size: number): Stat {
	return {
		type,
		mode: type === "dir" ? 0o40755 : 0o100644,
		size,
		ino: 0,
		mtimeMs: 0,
		ctimeMs: 0,
		uid: 0,
		gid: 0,
		dev: 0,
		isFile: () => type === "file",
		isDirectory: () => type === "dir",
		isSymbolicLink: () => false,
	};
}

export function createReadonlyGitFs(opts: ReadonlyGitFsOptions) {
	const files = new Set(opts.files);
	const dirs = new Set<string>([""]);
	for (const f of files) {
		const parts = f.split("/");
		for (let i = 1; i < parts.length; i++)
			dirs.add(parts.slice(0, i).join("/"));
	}
	const resolve = opts.resolve ?? ((u: string) => u);
	const doFetch = opts.fetch ?? ((u: string) => fetch(u));
	const cache = new Map<string, Promise<Uint8Array>>();
	const decoder = new TextDecoder();

	/** "/git/objects/pack" -> "objects/pack"; null for anything outside the virtual git dir. */
	const rel = (path: string): string | null => {
		const p = path.replace(/\/+$/, "");
		if (p === VIRTUAL_GITDIR) return "";
		if (!p.startsWith(`${VIRTUAL_GITDIR}/`)) return null;
		return p.slice(VIRTUAL_GITDIR.length + 1);
	};

	const load = (r: string): Promise<Uint8Array> => {
		let pending = cache.get(r);
		if (!pending) {
			pending = doFetch(resolve(`${opts.baseUrl}${r}`)).then(async (res) => {
				if (!res.ok) throw new FsError("ENOENT", r);
				return new Uint8Array(await res.arrayBuffer());
			});
			pending.catch(() => cache.delete(r));
			cache.set(r, pending);
		}
		return pending;
	};

	const readOnly = async (path: string): Promise<never> => {
		throw new FsError("EROFS", path);
	};

	const promises = {
		async readFile(path: string, options?: string | { encoding?: string }) {
			const r = rel(path);
			if (r === null || !files.has(r)) throw new FsError("ENOENT", path);
			const bytes = await load(r);
			const encoding =
				typeof options === "string" ? options : options?.encoding;
			return encoding ? decoder.decode(bytes) : bytes;
		},
		async stat(path: string): Promise<Stat> {
			const r = rel(path);
			if (r !== null && dirs.has(r)) return statOf("dir", 0);
			if (r !== null && files.has(r)) return statOf("file", 0);
			throw new FsError("ENOENT", path);
		},
		async lstat(path: string): Promise<Stat> {
			return promises.stat(path);
		},
		async readdir(path: string): Promise<string[]> {
			const r = rel(path);
			if (r === null || !dirs.has(r)) throw new FsError("ENOENT", path);
			const prefix = r ? `${r}/` : "";
			const names = new Set<string>();
			for (const entry of [...files, ...dirs]) {
				if (entry === r || !entry.startsWith(prefix)) continue;
				const name = entry.slice(prefix.length).split("/")[0];
				if (name) names.add(name);
			}
			return [...names].sort();
		},
		async readlink(path: string): Promise<never> {
			throw new FsError("ENOENT", path);
		},
		writeFile: readOnly,
		unlink: readOnly,
		mkdir: readOnly,
		rmdir: readOnly,
		symlink: readOnly,
		chmod: readOnly,
	};
	return { promises };
}
