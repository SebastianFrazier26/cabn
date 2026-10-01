import {
	GIT_FILES_FILENAME,
	GIT_FORMAT_VERSION,
	GIT_META_FILENAME,
	type GitBranchSummary,
	type GitFiles,
	GitFilesSchema,
	type GitMeta,
	GitMetaSchema,
	type GitTagSummary,
	MAX_OMITTED_BLOB_RECORDS,
	type OmittedBlobReason,
	RELEASES_FILENAME,
	RELEASES_VERSION,
	type ReleasesFile,
	ReleasesFileSchema,
	type ResolvedHistoryCaps,
} from "@cabn/world-schema";
import {
	currentBranch,
	listBranches,
	listRemotes,
	listTags,
	log,
	type ReadCommitResult,
	readCommit,
	readObject,
	readTag,
	resolveRef,
} from "isomorphic-git";
import { findLeakedSecretSpans } from "../annotate/leakedSecret.js";
import { isIgnoredPath, isSecretPath } from "../walk.js";
import {
	fetchGithubReleases,
	type GithubNetwork,
	parseGithubRemote,
} from "./githubReleases.js";
import {
	decodeText,
	looksBinary,
	type OpenedRepo,
	readTreeEntries,
} from "./gitRepo.js";
import {
	type GitObjectType,
	type PackEntry,
	packEntry,
	packSize,
	writePack,
} from "./packfile.js";

export interface BuildGitDirOptions {
	caps: ResolvedHistoryCaps;
	/** convert()'s extra ignore entries (DEFAULT_IGNORES apply too). */
	ignore: readonly string[];
	/** Absent: releases are recorded as "offline". */
	github?: GithubNetwork;
	/** cabn.json `history.releases: false`. */
	releasesDisabled?: boolean;
}

export type GitDirFiles = Map<string, Uint8Array | string>;

interface BranchRef {
	name: string;
	ref: string | null;
	head: string;
	remote: boolean;
	current: boolean;
	time: number;
}

interface TagRef {
	name: string;
	/** refs/tags/<name> value: the tag object (annotated) or the commit. */
	refOid: string;
	/** Every tag object on the way to the commit (nested tags included). */
	tagObjects: string[];
	summary: GitTagSummary;
	sortTime: number;
}

const encoder = new TextEncoder();

class Reader {
	private readonly packed = new Map<string, PackEntry>();
	private readonly blobSizes = new Map<string, number>();
	private readonly secretVerdicts = new Map<string, boolean>();

	constructor(
		readonly repo: OpenedRepo,
		readonly opts: BuildGitDirOptions,
	) {}

	get base() {
		return {
			fs: this.repo.fs,
			gitdir: this.repo.gitdir,
			cache: this.repo.cache,
		};
	}

	commit(oid: string): Promise<ReadCommitResult> {
		return readCommit({ ...this.base, oid });
	}

	/** The object as it will sit in the pack; read and deflated once per oid. */
	async entry(oid: string): Promise<PackEntry> {
		let e = this.packed.get(oid);
		if (!e) {
			const raw = await readObject({ ...this.base, oid, format: "content" });
			e = packEntry(oid, raw.type as GitObjectType, raw.object as Uint8Array);
			this.packed.set(oid, e);
		}
		return e;
	}

	/** Blob size without keeping (or deflating) its bytes — over-cap blobs never reach the pack. */
	async blobSize(oid: string): Promise<number> {
		let size = this.blobSizes.get(oid);
		if (size === undefined) {
			const raw = await readObject({ ...this.base, oid, format: "content" });
			size = (raw.object as Uint8Array).length;
			this.blobSizes.set(oid, size);
		}
		return size;
	}

	/**
	 * Whether the leaked-secret detector finds a key in this text blob under
	 * any of the names it was reached by (the names matter: test and example
	 * files skip the generic-assignment tier). Cached per oid from the first,
	 * deepest selection, so a later halving can only keep a verdict of
	 * "withhold", never lose it.
	 */
	async leaksSecret(oid: string, names: ReadonlySet<string>): Promise<boolean> {
		let verdict = this.secretVerdicts.get(oid);
		if (verdict === undefined) {
			const raw = await readObject({ ...this.base, oid, format: "content" });
			const bytes = raw.object as Uint8Array;
			if (looksBinary(bytes)) verdict = false;
			else {
				const text = decodeText(bytes);
				verdict = [...names].some(
					(name) => findLeakedSecretSpans(text, name).length > 0,
				);
			}
			this.secretVerdicts.set(oid, verdict);
		}
		return verdict;
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
		const time = async (oid: string) =>
			(await this.commit(oid)).commit.committer.timestamp;
		const localNames = await listBranches({ ...this.base });
		for (const name of localNames) {
			const head = await resolveRef({
				...this.base,
				ref: `refs/heads/${name}`,
			});
			refs.push({
				name,
				ref: `refs/heads/${name}`,
				head,
				remote: false,
				current: name === headBranch,
				time: await time(head),
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
				const ref = `refs/remotes/origin/${name}`;
				const head = await resolveRef({ ...this.base, ref });
				refs.push({
					name: `origin/${name}`,
					ref,
					head,
					remote: true,
					current: false,
					time: await time(head),
				});
			} catch {
				// A dangling remote ref (objects pruned) is simply not listed.
			}
		}
		if (!headBranch) {
			refs.push({
				name: "HEAD",
				ref: null,
				head: headOid,
				remote: false,
				current: true,
				time: await time(headOid),
			});
		}
		refs.sort((a, b) =>
			a.current !== b.current
				? a.current
					? -1
					: 1
				: b.time - a.time || (a.name < b.name ? -1 : 1),
		);
		return {
			list: refs.slice(0, this.opts.caps.maxBranches),
			truncated: refs.length > this.opts.caps.maxBranches,
			headOid,
			headBranch,
		};
	}

	async tags(): Promise<{ list: TagRef[]; truncated: boolean }> {
		const out: TagRef[] = [];
		for (const name of await listTags({ ...this.base })) {
			try {
				const refOid = await resolveRef({
					...this.base,
					ref: `refs/tags/${name}`,
				});
				let oid = refOid;
				const tagObjects: string[] = [];
				let first: Awaited<ReturnType<typeof readTag>>["tag"] | undefined;
				for (let depth = 0; depth < 5; depth++) {
					let tag: Awaited<ReturnType<typeof readTag>>["tag"];
					try {
						tag = (await readTag({ ...this.base, oid })).tag;
					} catch {
						break;
					}
					tagObjects.push(oid);
					first ??= tag;
					oid = tag.object;
					if (tag.type !== "tag") break;
				}
				const commitTime = (await this.commit(oid)).commit.committer.timestamp;
				out.push({
					name,
					refOid,
					tagObjects,
					summary: {
						name,
						oid,
						annotated: first !== undefined,
						...(first
							? {
									message: first.message.trimEnd().slice(0, 4000),
									tagger: first.tagger.name.slice(0, 200),
									time: first.tagger.timestamp,
								}
							: {}),
					},
					sortTime: first?.tagger.timestamp ?? commitTime,
				});
			} catch {
				// A tag on a tree/blob, or on pruned objects: not shipped.
			}
		}
		out.sort((a, b) => b.sortTime - a.sortTime || (a.name < b.name ? -1 : 1));
		return {
			list: out.slice(0, this.opts.caps.maxTags),
			truncated: out.length > this.opts.caps.maxTags,
		};
	}

	async releases(): Promise<ReleasesFile> {
		const empty = {
			releasesVersion: RELEASES_VERSION as typeof RELEASES_VERSION,
			items: [],
			packages: [],
		};
		if (this.opts.releasesDisabled) return { ...empty, source: "none" };
		let remotes: { remote: string; url: string }[] = [];
		try {
			remotes = await listRemotes({
				fs: this.repo.fs,
				gitdir: this.repo.gitdir,
			});
		} catch {
			remotes = [];
		}
		const repo = [
			...remotes.filter((r) => r.remote === "origin"),
			...remotes.filter((r) => r.remote !== "origin"),
		]
			.map((r) => parseGithubRemote(r.url))
			.find((r) => r !== null);
		if (!repo) return { ...empty, source: "none" };
		if (!this.opts.github)
			return {
				...empty,
				source: "offline",
				repo: {
					owner: repo.owner,
					name: repo.name,
					url: `https://github.com/${repo.owner}/${repo.name}`,
				},
			};
		const fetched = await fetchGithubReleases(
			this.opts.github,
			repo,
			this.opts.caps.maxReleases,
		);
		return { releasesVersion: RELEASES_VERSION, ...fetched };
	}
}

interface Selection {
	commits: Set<string>;
	perBranch: Map<string, { count: number; truncated: boolean }>;
	shallow: string[];
	trees: Set<string>;
	blobs: Set<string>;
	omitted: Map<string, { reason: OmittedBlobReason; size: number }>;
}

/**
 * Commits within `depth` of each branch head (plus tag targets), and every
 * tree and blob they reach — except blobs of secret-named files, text blobs
 * the leaked-secret detector flags, blobs over maxBlobBytes, and whole
 * folders the world ignores. Those stay referenced
 * by their trees but absent from the pack.
 */
async function select(
	reader: Reader,
	branches: BranchRef[],
	tags: TagRef[],
	depth: number,
): Promise<Selection> {
	const commits = new Set<string>();
	const parents = new Map<string, string[]>();
	const trees = new Map<string, string>();
	const perBranch = new Map<string, { count: number; truncated: boolean }>();
	for (const branch of branches) {
		let entries: ReadCommitResult[];
		try {
			entries = await log({ ...reader.base, ref: branch.head, depth });
		} catch {
			continue;
		}
		for (const e of entries) {
			commits.add(e.oid);
			parents.set(e.oid, e.commit.parent);
			trees.set(e.oid, e.commit.tree);
		}
		const last = entries[entries.length - 1];
		perBranch.set(branch.name, {
			count: entries.length,
			truncated:
				entries.length >= depth && (last?.commit.parent.length ?? 0) > 0,
		});
	}
	for (const tag of tags) {
		if (commits.has(tag.summary.oid)) continue;
		const c = await reader.commit(tag.summary.oid);
		commits.add(c.oid);
		parents.set(c.oid, c.commit.parent);
		trees.set(c.oid, c.commit.tree);
	}
	const shallow = [...commits]
		.filter((oid) => (parents.get(oid) ?? []).some((p) => !commits.has(p)))
		.sort();

	const treeSet = new Set<string>();
	const visited = new Set<string>();
	// Blob oid -> the "<folder>/<name>" it was reached under (more than one when a file was copied or renamed).
	const allowedBlobs = new Map<string, Set<string>>();
	const secretOnly = new Set<string>();
	const ignoredOnly = new Set<string>();
	// Every rule below looks at an entry's name plus the one folder it sits in
	// (the secret patterns are never deeper, see walk.ts), so a tree is walked
	// once per name it's mounted under, not once per commit.
	const walkTree = async (oid: string, folder: string): Promise<void> => {
		const key = `${oid}/${folder}`;
		if (visited.has(key)) return;
		visited.add(key);
		treeSet.add(oid);
		for (const entry of await readTreeEntries(reader.repo, oid)) {
			const ignored = isIgnoredPath(entry.path, reader.opts.ignore);
			const named = folder ? `${folder}/${entry.path}` : entry.path;
			if (entry.type === "tree") {
				if (!ignored) await walkTree(entry.oid, entry.path);
			} else if (entry.type === "blob") {
				if (ignored) ignoredOnly.add(entry.oid);
				else if (isSecretPath(named)) secretOnly.add(entry.oid);
				else {
					const names = allowedBlobs.get(entry.oid) ?? new Set<string>();
					names.add(named);
					allowedBlobs.set(entry.oid, names);
				}
			}
		}
	};
	for (const oid of commits) await walkTree(trees.get(oid) as string, "");

	const blobs = new Set<string>();
	const omitted = new Map<
		string,
		{ reason: OmittedBlobReason; size: number }
	>();
	for (const [oid, names] of allowedBlobs) {
		const size = await reader.blobSize(oid);
		if (size > reader.opts.caps.maxBlobBytes)
			omitted.set(oid, { reason: "too-large", size });
		// Same "not shipped" record as a secret-named file: older engines parse
		// the reason enum strictly, and either way the blob's hash stays in its tree.
		else if (await reader.leaksSecret(oid, names))
			omitted.set(oid, { reason: "secret-name", size });
		else blobs.add(oid);
	}
	// A blob also reachable under an ordinary name is already shipped there (unless its content withheld it above); only one never reachable any other way is withheld.
	for (const oid of secretOnly)
		if (!allowedBlobs.has(oid))
			omitted.set(oid, {
				reason: "secret-name",
				size: await reader.blobSize(oid),
			});
	for (const oid of ignoredOnly)
		if (!allowedBlobs.has(oid) && !secretOnly.has(oid))
			omitted.set(oid, { reason: "ignored", size: await reader.blobSize(oid) });
	return { commits, perBranch, shallow, trees: treeSet, blobs, omitted };
}

function packedRefs(branches: BranchRef[], tags: TagRef[]): string {
	const lines: { ref: string; text: string }[] = [];
	for (const b of branches)
		if (b.ref) lines.push({ ref: b.ref, text: `${b.head} ${b.ref}` });
	for (const t of tags) {
		const ref = `refs/tags/${t.name}`;
		lines.push({
			ref,
			text:
				t.tagObjects.length > 0
					? `${t.refOid} ${ref}\n^${t.summary.oid}`
					: `${t.refOid} ${ref}`,
		});
	}
	lines.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
	return `# pack-refs with: peeled fully-peeled sorted \n${lines.map((l) => l.text).join("\n")}\n`;
}

/**
 * The world's read-only git directory: the repository's real objects for
 * recent history (see select()), under `git/`, plus files.json, meta.json
 * and releases.json. The per-branch boundary halves until the pack fits
 * maxPackBytes; at a single commit per branch, the largest blobs go next.
 * Returns null for a repository with no commits.
 */
export async function buildGitDirectory(
	repo: OpenedRepo,
	opts: BuildGitDirOptions,
): Promise<GitDirFiles | null> {
	const reader = new Reader(repo, opts);
	let info: Awaited<ReturnType<Reader["branches"]>>;
	try {
		info = await reader.branches();
	} catch {
		return null;
	}
	const tags = await reader.tags();

	let depth = opts.caps.maxCommitsPerBranch;
	let halvings = 0;
	let sel: Selection;
	let entries: PackEntry[];
	for (;;) {
		sel = await select(reader, info.list, tags.list, depth);
		const oids = [
			...sel.commits,
			...sel.trees,
			...sel.blobs,
			...tags.list.flatMap((t) => t.tagObjects),
		];
		entries = [];
		for (const oid of oids) entries.push(await reader.entry(oid));
		if (packSize(entries) <= opts.caps.maxPackBytes || depth === 1) break;
		depth = Math.max(1, Math.floor(depth / 2));
		halvings++;
	}
	if (packSize(entries) > opts.caps.maxPackBytes) {
		const blobEntries = entries
			.filter((e) => sel.blobs.has(e.oid))
			.sort((a, b) => b.bytes.length - a.bytes.length);
		let size = packSize(entries);
		const dropped = new Set<string>();
		for (const e of blobEntries) {
			if (size <= opts.caps.maxPackBytes) break;
			dropped.add(e.oid);
			size -= e.bytes.length;
			sel.omitted.set(e.oid, {
				reason: "pack-cap",
				size: await reader.blobSize(e.oid),
			});
		}
		entries = entries.filter((e) => !dropped.has(e.oid));
	}
	const written = await writePack(entries);

	const branches: GitBranchSummary[] = [];
	for (const b of info.list) {
		const head = await reader.commit(b.head);
		const stats = sel.perBranch.get(b.name) ?? { count: 0, truncated: true };
		branches.push({
			name: b.name,
			ref: b.ref ?? "HEAD",
			head: b.head,
			current: b.current,
			remote: b.remote,
			commits: stats.count,
			truncated: stats.truncated,
			subject: (head.commit.message.split("\n", 1)[0] ?? "").slice(0, 500),
			author: head.commit.author.name.slice(0, 200),
			time: head.commit.committer.timestamp,
		});
	}
	const omitted: GitMeta["omitted"] = {};
	for (const [oid, record] of [...sel.omitted].slice(
		0,
		MAX_OMITTED_BLOB_RECORDS,
	))
		omitted[oid] = record;
	const meta: GitMeta = GitMetaSchema.parse({
		gitVersion: GIT_FORMAT_VERSION,
		head: { branch: info.headBranch, oid: info.headOid },
		branches,
		tags: tags.list.map((t) => t.summary),
		pack: {
			bytes: written.pack.length,
			objects: entries.length,
			commitsPerBranch: depth,
			halvings,
		},
		omitted,
		truncated: { branches: info.truncated, tags: tags.truncated },
	});

	const files: GitDirFiles = new Map();
	files.set(
		"git/HEAD",
		info.headBranch
			? `ref: refs/heads/${info.headBranch}\n`
			: `${info.headOid}\n`,
	);
	files.set(
		"git/config",
		"[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n",
	);
	files.set("git/packed-refs", packedRefs(info.list, tags.list));
	if (sel.shallow.length > 0)
		files.set("git/shallow", `${sel.shallow.join("\n")}\n`);
	files.set(`git/objects/pack/pack-${written.name}.pack`, written.pack);
	files.set(`git/objects/pack/pack-${written.name}.idx`, written.index);
	const listing: GitFiles = GitFilesSchema.parse({
		gitVersion: GIT_FORMAT_VERSION,
		files: [...files.keys()].map((k) => k.slice("git/".length)).sort(),
	});
	files.set(GIT_FILES_FILENAME, JSON.stringify(listing));
	files.set(GIT_META_FILENAME, JSON.stringify(meta));
	files.set(
		RELEASES_FILENAME,
		JSON.stringify(ReleasesFileSchema.parse(await reader.releases())),
	);
	return files;
}

export function gitDirBytes(files: GitDirFiles): number {
	let n = 0;
	for (const v of files.values())
		n += typeof v === "string" ? encoder.encode(v).length : v.length;
	return n;
}
