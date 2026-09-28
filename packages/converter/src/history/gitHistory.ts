import {
	HISTORY_INDEX_VERSION,
	type HistoryBranch,
	type HistoryChange,
	type HistoryCommit,
	type HistoryCommitDiffFile,
	HistoryCommitDiffFileSchema,
	type HistoryHunk,
	type HistoryIndexFile,
	HistoryIndexFileSchema,
	type HistoryTag,
	historyDiffFilePath,
	MAX_HISTORY_CHANGES_PER_COMMIT,
	MAX_HISTORY_MESSAGE_CHARS,
	type ResolvedHistoryCaps,
	universeWorldUrl,
} from "@cabn/world-schema";
import {
	currentBranch,
	hashBlob,
	isIgnored as isGitIgnored,
	listBranches,
	listRemotes,
	listTags,
	log,
	type ReadCommitResult,
	readCommit,
	readTag,
	resolveRef,
	type TreeEntry,
} from "isomorphic-git";
import { containsLeakedSecret } from "../annotate/leakedSecret.js";
import { classify } from "../classify.js";
import { shortHash } from "../hash.js";
import { isIgnoredPath, isSecretPath } from "../walk.js";
import { diffText } from "./diff.js";
import {
	fetchGithubReleases,
	type GithubNetwork,
	parseGithubRemote,
} from "./githubReleases.js";
import {
	decodeText,
	isRegularBlob,
	looksBinary,
	type OpenedRepo,
	readBlobBytes,
	readTreeEntries,
	subtreeAt,
} from "./gitRepo.js";

export interface BuildHistoryOptions {
	caps: ResolvedHistoryCaps;
	/** convert()'s extra ignore entries (walk() adds DEFAULT_IGNORES itself). */
	ignore: readonly string[];
	/** Blobs larger than this ship as "too-large" (same per-file cap the world uses). */
	maxFileBytes: number;
	/** The main world's walked files, for `dirtyPaths`. */
	worldFiles: readonly { path: string; content?: Uint8Array }[];
	/** Absent: releases are recorded as "offline". */
	github?: GithubNetwork;
	/** cabn.json `history.releases: false`. */
	releasesDisabled?: boolean;
}

export interface UniverseCandidate {
	branch: string;
	slug: string;
	/** The branch head's tree at the world's prefix. */
	treeOid: string;
}

export interface HistoryBuild {
	/** Alternate branches to prebuild, best first, already capped at maxUniverses. */
	universes: UniverseCandidate[];
	/** Records which universes were actually built and returns the bundle files (history.json + diffs). */
	finalize(
		outcome: ReadonlyMap<string, "built" | "over-budget" | "failed">,
	): Map<string, string>;
}

const WITHHELD_MESSAGE = "(message withheld: it may contain a secret)";
// Names and messages are shown verbatim; control characters (other than
// tab/newline) would only ever be noise or a terminal trick.
function stripControl(text: string): string {
	let out = "";
	for (const ch of text) {
		const code = ch.charCodeAt(0);
		if ((code < 32 && ch !== "\t" && ch !== "\n") || code === 127) continue;
		out += ch;
	}
	return out;
}

function cleanName(name: string): string {
	return stripControl(name).slice(0, 200);
}

function cleanMessage(message: string): { message: string; withheld?: true } {
	const trimmed = stripControl(message).trimEnd();
	if (containsLeakedSecret(trimmed, "COMMIT_EDITMSG", { strict: true }))
		return { message: WITHHELD_MESSAGE, withheld: true };
	return { message: trimmed.slice(0, MAX_HISTORY_MESSAGE_CHARS) };
}

export function universeSlug(branch: string): string {
	const base = branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return `${base || "branch"}-${shortHash(branch)}`;
}

interface BranchRef {
	name: string;
	head: string;
	remote: boolean;
	current: boolean;
	time: number;
}

interface CommitWork {
	commit: HistoryCommit;
	hunks: { path: string; hunks: HistoryHunk[] }[];
}

type BlobVerdict = "ok" | "sealed-secret" | "binary" | "too-large";

class HistoryReader {
	private readonly blobVerdicts = new Map<string, BlobVerdict>();
	private readonly gitIgnored = new Map<string, boolean>();

	constructor(
		private readonly repo: OpenedRepo,
		private readonly opts: BuildHistoryOptions,
	) {}

	private get base() {
		return {
			fs: this.repo.fs,
			gitdir: this.repo.gitdir,
			cache: this.repo.cache,
		};
	}

	async readCommit(oid: string): Promise<ReadCommitResult> {
		return readCommit({ ...this.base, oid });
	}

	async commitTime(oid: string): Promise<number> {
		return (await this.readCommit(oid)).commit.committer.timestamp;
	}

	async branches(): Promise<{
		list: BranchRef[];
		truncated: boolean;
		headOid: string;
		headBranch: string | null;
	}> {
		const headOid = await resolveRef({ ...this.base, ref: "HEAD" });
		const headBranch =
			(await currentBranch({ ...this.base, fullname: false })) || null;
		const refs: BranchRef[] = [];
		const localNames = await listBranches({ ...this.base });
		for (const name of localNames) {
			const head = await resolveRef({
				...this.base,
				ref: `refs/heads/${name}`,
			});
			refs.push({
				name,
				head,
				remote: false,
				current: name === headBranch,
				time: await this.commitTime(head),
			});
		}
		let remoteNames: string[] = [];
		try {
			remoteNames = await listBranches({ ...this.base, remote: "origin" });
		} catch {
			remoteNames = [];
		}
		const local = new Set(localNames);
		for (const name of remoteNames) {
			if (name === "HEAD" || local.has(name)) continue;
			try {
				const head = await resolveRef({
					...this.base,
					ref: `refs/remotes/origin/${name}`,
				});
				refs.push({
					name: `origin/${name}`,
					head,
					remote: true,
					current: false,
					time: await this.commitTime(head),
				});
			} catch {
				// A dangling remote ref (objects pruned) is simply not listed.
			}
		}
		if (!headBranch) {
			refs.push({
				name: "HEAD",
				head: headOid,
				remote: false,
				current: true,
				time: await this.commitTime(headOid),
			});
		}
		refs.sort((a, b) =>
			a.current !== b.current
				? a.current
					? -1
					: 1
				: b.time - a.time || (a.name < b.name ? -1 : 1),
		);
		const truncated = refs.length > this.opts.caps.maxBranches;
		return {
			list: refs.slice(0, this.opts.caps.maxBranches),
			truncated,
			headOid,
			headBranch,
		};
	}

	async branchLog(
		head: string,
	): Promise<{ commits: ReadCommitResult[]; truncated: boolean }> {
		const depth = this.opts.caps.maxCommitsPerBranch;
		const commits = await log({ ...this.base, ref: head, depth });
		const last = commits[commits.length - 1];
		return {
			commits,
			truncated:
				commits.length >= depth && (last?.commit.parent.length ?? 0) > 0,
		};
	}

	async tags(): Promise<{ list: HistoryTag[]; truncated: boolean }> {
		const tags: (HistoryTag & { sortTime: number })[] = [];
		for (const name of await listTags({ ...this.base })) {
			try {
				let oid = await resolveRef({ ...this.base, ref: `refs/tags/${name}` });
				let annotated = false;
				let message: string | undefined;
				let messageWithheld: true | undefined;
				let tagger: string | undefined;
				let time: number | undefined;
				for (let depth = 0; depth < 5; depth++) {
					let tag: Awaited<ReturnType<typeof readTag>>["tag"];
					try {
						tag = (await readTag({ ...this.base, oid })).tag;
					} catch {
						break;
					}
					if (!annotated) {
						annotated = true;
						const cleaned = cleanMessage(tag.message);
						message = cleaned.message;
						messageWithheld = cleaned.withheld;
						tagger = cleanName(tag.tagger.name);
						time = tag.tagger.timestamp;
					}
					oid = tag.object;
					if (tag.type !== "tag") break;
				}
				const commitTime = await this.commitTime(oid);
				tags.push({
					name,
					oid,
					annotated,
					...(message !== undefined ? { message } : {}),
					...(messageWithheld ? { messageWithheld } : {}),
					...(tagger !== undefined ? { tagger } : {}),
					...(time !== undefined ? { time } : {}),
					sortTime: time ?? commitTime,
				});
			} catch {
				// A tag on a tree/blob, or on pruned objects: not shown.
			}
		}
		tags.sort((a, b) => b.sortTime - a.sortTime || (a.name < b.name ? -1 : 1));
		const truncated = tags.length > this.opts.caps.maxTags;
		return {
			list: tags
				.slice(0, this.opts.caps.maxTags)
				.map(({ sortTime: _sortTime, ...tag }) => tag),
			truncated,
		};
	}

	private async skipPath(path: string): Promise<boolean> {
		if (isIgnoredPath(path, this.opts.ignore)) return true;
		const repoPath = this.repo.prefix ? `${this.repo.prefix}/${path}` : path;
		let ignored = this.gitIgnored.get(repoPath);
		if (ignored === undefined) {
			try {
				ignored = await isGitIgnored({
					fs: this.repo.fs,
					dir: this.repo.root,
					gitdir: this.repo.gitdir,
					filepath: repoPath,
				});
			} catch {
				ignored = false;
			}
			this.gitIgnored.set(repoPath, ignored);
		}
		return ignored;
	}

	/** Changed regular files between two trees (either may be null), as world-relative paths. */
	private async diffTrees(
		oldTree: string | null,
		newTree: string | null,
		base: string,
		out: { path: string; oldOid: string | null; newOid: string | null }[],
	): Promise<void> {
		if (oldTree === newTree) return;
		const oldEntries = oldTree ? await readTreeEntries(this.repo, oldTree) : [];
		const newEntries = newTree ? await readTreeEntries(this.repo, newTree) : [];
		const byName = new Map<string, { old?: TreeEntry; new?: TreeEntry }>();
		for (const e of oldEntries) byName.set(e.path, { old: e });
		for (const e of newEntries)
			byName.set(e.path, { ...(byName.get(e.path) ?? {}), new: e });
		const names = [...byName.keys()].sort();
		for (const name of names) {
			if (out.length > MAX_HISTORY_CHANGES_PER_COMMIT) return;
			const pair = byName.get(name) as { old?: TreeEntry; new?: TreeEntry };
			const path = base ? `${base}/${name}` : name;
			if (pair.old?.oid === pair.new?.oid) continue;
			if (await this.skipPath(path)) continue;
			const oldIsTree = pair.old?.type === "tree";
			const newIsTree = pair.new?.type === "tree";
			if (oldIsTree || newIsTree) {
				await this.diffTrees(
					oldIsTree ? (pair.old?.oid ?? null) : null,
					newIsTree ? (pair.new?.oid ?? null) : null,
					path,
					out,
				);
			}
			const oldBlob = pair.old && isRegularBlob(pair.old) ? pair.old.oid : null;
			const newBlob = pair.new && isRegularBlob(pair.new) ? pair.new.oid : null;
			if (oldBlob || newBlob)
				out.push({ path, oldOid: oldBlob, newOid: newBlob });
		}
	}

	private async blobVerdict(
		oid: string,
		path: string,
	): Promise<{ verdict: BlobVerdict; text?: string }> {
		// Keyed with the path too: classify() reads the extension, so one blob can be text under one name and binary under another.
		const key = `${oid}\0${path}`;
		const cached = this.blobVerdicts.get(key);
		if (cached && cached !== "ok") return { verdict: cached };
		const bytes = await readBlobBytes(this.repo, oid);
		let verdict: BlobVerdict = "ok";
		if (bytes.length > this.opts.maxFileBytes) verdict = "too-large";
		else if (looksBinary(bytes) || classify(path, bytes).binary)
			verdict = "binary";
		const text = verdict === "ok" ? decodeText(bytes) : undefined;
		if (
			text !== undefined &&
			(cached === undefined
				? containsLeakedSecret(text, path, { strict: true })
				: false)
		)
			verdict = "sealed-secret";
		this.blobVerdicts.set(key, verdict);
		return verdict === "ok" ? { verdict, text } : { verdict };
	}

	async commitWork(result: ReadCommitResult): Promise<CommitWork> {
		const { oid, commit } = result;
		const parent = commit.parent[0];
		const newTree = await subtreeAt(this.repo, commit.tree, this.repo.prefix);
		const oldTree = parent
			? await subtreeAt(
					this.repo,
					(await this.readCommit(parent)).commit.tree,
					this.repo.prefix,
				)
			: null;
		const pairs: {
			path: string;
			oldOid: string | null;
			newOid: string | null;
		}[] = [];
		await this.diffTrees(oldTree, newTree, "", pairs);
		const changesTruncated = pairs.length > MAX_HISTORY_CHANGES_PER_COMMIT;
		const changes: HistoryChange[] = [];
		const hunks: CommitWork["hunks"] = [];
		for (const pair of pairs.slice(0, MAX_HISTORY_CHANGES_PER_COMMIT)) {
			const status = !pair.oldOid
				? "added"
				: !pair.newOid
					? "deleted"
					: "modified";
			const change = await this.classify(pair, status);
			changes.push(change.change);
			if (change.hunks) hunks.push({ path: pair.path, hunks: change.hunks });
		}
		const cleaned = cleanMessage(commit.message);
		return {
			commit: {
				oid,
				parents: commit.parent.slice(0, 16),
				author: cleanName(commit.author.name),
				time: commit.author.timestamp,
				message: cleaned.message,
				...(cleaned.withheld ? { messageWithheld: true as const } : {}),
				changes,
				...(changesTruncated ? { changesTruncated: true as const } : {}),
			},
			hunks,
		};
	}

	private async classify(
		pair: { path: string; oldOid: string | null; newOid: string | null },
		status: HistoryChange["status"],
	): Promise<{ change: HistoryChange; hunks?: HistoryHunk[] }> {
		const base = { path: pair.path, status };
		// Never read at all, from any commit, whatever includeSecrets says.
		if (isSecretPath(pair.path))
			return { change: { ...base, diff: "sealed-path" } };
		const oldSide = pair.oldOid
			? await this.blobVerdict(pair.oldOid, pair.path)
			: { verdict: "ok" as const, text: "" };
		const newSide = pair.newOid
			? await this.blobVerdict(pair.newOid, pair.path)
			: { verdict: "ok" as const, text: "" };
		for (const state of ["sealed-secret", "too-large", "binary"] as const) {
			if (oldSide.verdict === state || newSide.verdict === state)
				return { change: { ...base, diff: state } };
		}
		const diff = diffText(oldSide.text ?? "", newSide.text ?? "");
		if (!diff) return { change: { ...base, diff: "too-large" } };
		const counts = { additions: diff.additions, deletions: diff.deletions };
		if (JSON.stringify(diff.hunks).length > this.opts.caps.maxDiffBytesPerFile)
			return { change: { ...base, ...counts, diff: "too-large" } };
		return {
			change: { ...base, ...counts, diff: "included" },
			hunks: diff.hunks,
		};
	}

	/** Paths whose shipped content differs from HEAD — the engine can't rebuild their past versions from the world's copy. */
	async dirtyPaths(headOid: string): Promise<string[]> {
		const head = await this.readCommit(headOid);
		const tree = await subtreeAt(this.repo, head.commit.tree, this.repo.prefix);
		const headBlobs = new Map<string, string>();
		const collect = async (oid: string, base: string): Promise<void> => {
			for (const entry of await readTreeEntries(this.repo, oid)) {
				const path = base ? `${base}/${entry.path}` : entry.path;
				if (isIgnoredPath(path, this.opts.ignore)) continue;
				if (entry.type === "tree") await collect(entry.oid, path);
				else if (isRegularBlob(entry)) headBlobs.set(path, entry.oid);
			}
		};
		if (tree) await collect(tree, "");
		const dirty: string[] = [];
		for (const file of this.opts.worldFiles) {
			if (!file.content) continue;
			const { oid } = await hashBlob({ object: file.content });
			if (headBlobs.get(file.path) !== oid) dirty.push(file.path);
		}
		return dirty;
	}

	async releases(): Promise<HistoryIndexFile["releases"]> {
		if (this.opts.releasesDisabled)
			return { source: "none", items: [], packages: [] };
		let remotes: { remote: string; url: string }[] = [];
		try {
			remotes = await listRemotes({
				fs: this.repo.fs,
				gitdir: this.repo.gitdir,
			});
		} catch {
			remotes = [];
		}
		const ordered = [
			...remotes.filter((r) => r.remote === "origin"),
			...remotes.filter((r) => r.remote !== "origin"),
		];
		const repo = ordered
			.map((r) => parseGithubRemote(r.url))
			.find((r) => r !== null);
		if (!repo) return { source: "none", items: [], packages: [] };
		const repoInfo = {
			owner: repo.owner,
			name: repo.name,
			url: `https://github.com/${repo.owner}/${repo.name}`,
		};
		if (!this.opts.github)
			return { source: "offline", repo: repoInfo, items: [], packages: [] };
		return fetchGithubReleases(
			this.opts.github,
			repo,
			this.opts.caps.maxReleases,
		);
	}
}

function serializeDiff(oid: string, files: CommitWork["hunks"]): string {
	const file: HistoryCommitDiffFile = {
		historyVersion: HISTORY_INDEX_VERSION,
		oid,
		files: files.map((f) => ({ path: f.path, hunks: f.hunks })),
	};
	HistoryCommitDiffFileSchema.parse(file);
	return JSON.stringify(file);
}

/**
 * Reads recent history for every branch (capped), every tag, and the
 * GitHub releases, into history.json plus one diff file per commit.
 * Returns null for a repository with no commits yet.
 */
export async function buildGitHistory(
	repo: OpenedRepo,
	opts: BuildHistoryOptions,
): Promise<HistoryBuild | null> {
	const reader = new HistoryReader(repo, opts);
	let branchInfo: Awaited<ReturnType<HistoryReader["branches"]>>;
	try {
		branchInfo = await reader.branches();
	} catch {
		return null;
	}

	const work = new Map<string, CommitWork>();
	const branches: HistoryBranch[] = [];
	for (const ref of branchInfo.list) {
		let logResult: Awaited<ReturnType<HistoryReader["branchLog"]>>;
		try {
			logResult = await reader.branchLog(ref.head);
		} catch {
			continue;
		}
		for (const entry of logResult.commits) {
			if (!work.has(entry.oid))
				work.set(entry.oid, await reader.commitWork(entry));
		}
		branches.push({
			name: ref.name,
			head: ref.head,
			current: ref.current,
			remote: ref.remote,
			commits: logResult.commits.map((c) => c.oid),
			truncated: logResult.truncated,
		});
	}
	const tags = await reader.tags();
	for (const tag of tags.list) {
		if (!work.has(tag.oid)) {
			try {
				work.set(
					tag.oid,
					await reader.commitWork(await reader.readCommit(tag.oid)),
				);
			} catch {
				// unreadable target: the tag still lists, without commit details
			}
		}
	}

	const releases = await reader.releases();
	const dirtyPaths = await reader.dirtyPaths(branchInfo.headOid);

	const universes: UniverseCandidate[] = [];
	for (const branch of branches) {
		if (branch.current) continue;
		if (universes.length >= opts.caps.maxUniverses) {
			branch.universeSkipped = "cap";
			continue;
		}
		const head = await reader.readCommit(branch.head);
		const treeOid = await subtreeAt(repo, head.commit.tree, repo.prefix);
		if (!treeOid) continue;
		universes.push({
			branch: branch.name,
			slug: universeSlug(branch.name),
			treeOid,
		});
	}

	return {
		universes,
		finalize(outcome) {
			for (const branch of branches) {
				const state = outcome.get(branch.name);
				const candidate = universes.find((u) => u.branch === branch.name);
				if (state === "built" && candidate) {
					branch.universe = {
						slug: candidate.slug,
						worldUrl: universeWorldUrl(candidate.slug),
					};
				} else if (state === "over-budget" || state === "failed") {
					branch.universeSkipped = state;
				}
			}
			const ordered = [...work.values()].sort(
				(a, b) =>
					b.commit.time - a.commit.time ||
					(a.commit.oid < b.commit.oid ? -1 : 1),
			);
			const diffs = new Map<string, string>();
			for (const w of ordered) {
				if (w.hunks.length > 0)
					diffs.set(w.commit.oid, serializeDiff(w.commit.oid, w.hunks));
			}
			const buildIndex = (): HistoryIndexFile => ({
				historyVersion: HISTORY_INDEX_VERSION,
				head: { branch: branchInfo.headBranch, oid: branchInfo.headOid },
				commits: ordered.map((w) => ({
					...w.commit,
					...(diffs.has(w.commit.oid)
						? { diffFile: historyDiffFilePath(w.commit.oid) }
						: {}),
				})),
				branches,
				tags: tags.list,
				releases,
				dirtyPaths,
				truncated: {
					branches: branchInfo.truncated,
					tags: tags.truncated,
					omittedDiffs,
				},
			});
			let omittedDiffs = 0;
			let diffBytes = [...diffs.values()].reduce((n, s) => n + s.length, 0);
			let index = JSON.stringify(buildIndex());
			// Oldest diffs go first: recent history is what a visitor browses.
			for (
				let i = ordered.length - 1;
				i >= 0 && index.length + diffBytes > opts.caps.maxTotalBytes;
				i--
			) {
				const w = ordered[i] as CommitWork;
				const text = diffs.get(w.commit.oid);
				if (text === undefined) continue;
				diffs.delete(w.commit.oid);
				diffBytes -= text.length;
				for (const change of w.commit.changes) {
					if (change.diff === "included") {
						change.diff = "omitted";
						omittedDiffs++;
					}
				}
				index = JSON.stringify(buildIndex());
			}
			// Still over with every diff gone: the oldest commits lose their file lists too.
			for (
				let i = ordered.length - 1;
				i >= 0 && index.length > opts.caps.maxTotalBytes;
				i--
			) {
				const commit = (ordered[i] as CommitWork).commit;
				if (commit.changes.length === 0) continue;
				commit.changes = [];
				commit.changesTruncated = true;
				if (i % 16 === 0) index = JSON.stringify(buildIndex());
			}
			const finalIndex = buildIndex();
			HistoryIndexFileSchema.parse(finalIndex);
			const files = new Map<string, string>();
			files.set("history.json", JSON.stringify(finalIndex));
			for (const [oid, text] of diffs)
				files.set(historyDiffFilePath(oid), text);
			return files;
		},
	};
}
