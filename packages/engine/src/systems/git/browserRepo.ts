import "./bufferPolyfill.js";
import {
	convert,
	GitTreeSource,
	type OpenedRepo,
} from "@cabn/converter/browser";
import { type GitMeta, parseGitFiles } from "@cabn/world-schema";
import {
	log as gitLog,
	readBlob,
	readCommit,
	readTree,
	type TreeEntry,
} from "isomorphic-git";
import {
	resolveBundleUrl,
	resolveRelativeUrl,
} from "../../render/resolveUrl.js";
import { createReadonlyGitFs, VIRTUAL_GITDIR } from "./readonlyFs.js";
import type {
	BlobRead,
	BrowserRepo,
	ChangeStatus,
	CommitChanges,
	FileHistoryEntry,
	RepoCommit,
} from "./types.js";

/**
 * The lazily loaded half of the git UI: isomorphic-git over the world's
 * shipped git/ directory (systems/git/readonlyFs.ts), plus the converter,
 * for turning a branch into a walkable world on demand. Loaded on first use
 * of the rift, pensieve or map timeline — never on a plain page load.
 */
export async function openBrowserRepo(
	historyBase: string,
	meta: GitMeta,
): Promise<BrowserRepo> {
	const res = await fetch(resolveRelativeUrl(historyBase, "git/files.json"));
	const files = parseGitFiles(res.ok ? await res.json() : null);
	if (!files)
		throw new Error("this world's git/files.json is missing or invalid");
	const fs = createReadonlyGitFs({
		baseUrl: `${historyBase}git/`,
		files: files.files,
		resolve: resolveBundleUrl,
	});
	const cache = {};
	const base = { fs, gitdir: VIRTUAL_GITDIR, cache };
	const opened: OpenedRepo = {
		fs,
		root: VIRTUAL_GITDIR,
		gitdir: VIRTUAL_GITDIR,
		prefix: "",
		cache,
	};

	const logs = new Map<string, Promise<RepoCommit[]>>();
	const trees = new Map<string, Promise<TreeEntry[] | null>>();
	const universes = new Map<
		string,
		Promise<Map<string, Uint8Array | string>>
	>();
	const decoder = new TextDecoder();

	const treeEntries = (oid: string): Promise<TreeEntry[] | null> => {
		let pending = trees.get(oid);
		if (!pending) {
			// Unreadable = not shipped (an ignored folder); callers treat it as empty.
			pending = readTree({ ...base, oid }).then(
				(r) => r.tree,
				() => null,
			);
			trees.set(oid, pending);
		}
		return pending;
	};

	const blobAt = async (
		treeOid: string,
		path: string,
	): Promise<string | null> => {
		let oid = treeOid;
		const parts = path.split("/");
		for (let i = 0; i < parts.length; i++) {
			const entry = (await treeEntries(oid))?.find((e) => e.path === parts[i]);
			if (!entry) return null;
			if (i === parts.length - 1)
				return entry.type === "blob" ? entry.oid : null;
			if (entry.type !== "tree") return null;
			oid = entry.oid;
		}
		return null;
	};

	const refOf = (branch: string): string => {
		const summary = meta.branches.find((b) => b.name === branch);
		if (!summary)
			throw new Error(`no branch "${branch}" in this world's history`);
		return summary.ref;
	};

	const repo: BrowserRepo = {
		meta,
		log(branch) {
			let pending = logs.get(branch);
			if (!pending) {
				pending = gitLog({ ...base, ref: refOf(branch) }).then((entries) =>
					entries.map((e) => ({
						oid: e.oid,
						parents: e.commit.parent,
						message: e.commit.message,
						author: {
							name: e.commit.author.name,
							email: e.commit.author.email,
							timestamp: e.commit.author.timestamp,
						},
						tree: e.commit.tree,
					})),
				);
				logs.set(branch, pending);
			}
			return pending;
		},

		async changes(commit): Promise<CommitChanges> {
			const parent = commit.parents[0];
			let parentTree: string | null = null;
			if (parent) {
				try {
					parentTree = (await readCommit({ ...base, oid: parent })).commit.tree;
				} catch {
					return { changes: [], boundary: true };
				}
			}
			const changes: CommitChanges["changes"] = [];
			const walk = async (
				a: string | null,
				b: string | null,
				prefix: string,
			) => {
				if (a === b) return;
				const left = a ? ((await treeEntries(a)) ?? []) : [];
				const right = b ? ((await treeEntries(b)) ?? []) : [];
				const names = new Set([
					...left.map((e) => e.path),
					...right.map((e) => e.path),
				]);
				for (const name of [...names].sort()) {
					const l = left.find((e) => e.path === name);
					const r = right.find((e) => e.path === name);
					if (l?.oid === r?.oid) continue;
					const path = prefix ? `${prefix}/${name}` : name;
					if (l?.type === "tree" || r?.type === "tree") {
						await walk(
							l?.type === "tree" ? l.oid : null,
							r?.type === "tree" ? r.oid : null,
							path,
						);
					}
					const lb = l?.type === "blob";
					const rb = r?.type === "blob";
					if (lb || rb)
						changes.push({
							path,
							status: !lb ? "added" : !rb ? "deleted" : "modified",
						});
				}
			};
			await walk(parentTree, commit.tree, "");
			return { changes, boundary: false };
		},

		async fileHistory(branch, path): Promise<FileHistoryEntry[]> {
			const commits = await repo.log(branch);
			const inLog = new Map(commits.map((c) => [c.oid, c]));
			const out: FileHistoryEntry[] = [];
			for (const commit of commits) {
				const blob = await blobAt(commit.tree, path);
				const parentOid = commit.parents[0];
				const parent = parentOid ? inLog.get(parentOid) : undefined;
				if (parentOid && !parent) {
					if (blob)
						out.push({
							commit,
							status: "added",
							boundary: true,
							blob,
							parentBlob: null,
						});
					continue;
				}
				const parentBlob = parent ? await blobAt(parent.tree, path) : null;
				if (blob === parentBlob) continue;
				const status: ChangeStatus = !parentBlob
					? "added"
					: !blob
						? "deleted"
						: "modified";
				out.push({ commit, status, boundary: false, blob, parentBlob });
			}
			return out;
		},

		async readBlob(oid): Promise<BlobRead> {
			let bytes: Uint8Array;
			try {
				bytes = (await readBlob({ ...base, oid })).blob;
			} catch {
				const omitted = meta.omitted[oid];
				return omitted
					? { kind: "not-shipped", reason: omitted.reason, size: omitted.size }
					: { kind: "not-shipped", reason: "unknown" };
			}
			const limit = Math.min(bytes.length, 8000);
			for (let i = 0; i < limit; i++)
				if (bytes[i] === 0) return { kind: "binary", size: bytes.length };
			return { kind: "text", text: decoder.decode(bytes) };
		},

		convertUniverse(branch, opts) {
			let pending = universes.get(branch);
			if (!pending) {
				pending = (async () => {
					const head = meta.branches.find((b) => b.name === branch)?.head;
					if (!head)
						throw new Error(`no branch "${branch}" in this world's history`);
					const { commit } = await readCommit({ ...base, oid: head });
					const source = new GitTreeSource(opened, commit.tree, {
						ignore: [],
						omittedSizes: meta.omitted,
					});
					return convert(source, {
						name: opts.name,
						source: opts.source,
						// The main world's timestamp: a universe converted again on a later visit keeps its save slot.
						now: () => new Date(opts.generatedAt),
						sealedPaths: source.sealedPaths,
					});
				})();
				pending.catch(() => universes.delete(branch));
				universes.set(branch, pending);
			}
			return pending;
		},
	};
	return repo;
}
