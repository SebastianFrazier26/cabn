import { z } from "zod";

/**
 * Git history ships in its own `history.json` (plus one small diff file per
 * commit under history/commits/), never in world.json, for the same reason
 * media.json and embeds.json exist: every engine ever shipped parses
 * world.json strictly, so a new field there would make it reject the whole
 * world. Older engines never request these files. CABN_VERSION is unchanged.
 *
 * It is a precomputed JSON view, not a packfile: the converter withholds
 * secret-bearing blobs, and git objects are content-addressed, so a redacted
 * blob would no longer match its tree/commit hashes and a real git reader in
 * the browser would reject the history (or need forged objects). Shipping
 * only the diffs of the files a commit touched is also far smaller than the
 * blobs a packfile would need.
 */
export const HISTORY_INDEX_VERSION = 1;
export const HISTORY_INDEX_FILENAME = "history.json";

export const DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH = 200;
export const DEFAULT_HISTORY_MAX_BRANCHES = 20;
export const DEFAULT_HISTORY_MAX_TAGS = 50;
export const DEFAULT_HISTORY_MAX_UNIVERSES = 3;
export const DEFAULT_HISTORY_MAX_RELEASES = 10;
export const DEFAULT_HISTORY_MAX_DIFF_BYTES_PER_FILE = 64 * 1024;
export const DEFAULT_HISTORY_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const DEFAULT_HISTORY_MAX_UNIVERSE_TOTAL_BYTES = 50 * 1024 * 1024;

/** cabn.json `history`: every field optional and bounded, so a hand-edited value can't ask for an unbounded bundle. */
export const HistoryConfigSchema = z
	.strictObject({
		/** false: no history.json, no universes, no releases fetch. */
		enabled: z.boolean(),
		maxCommitsPerBranch: z.number().int().min(1).max(1000),
		maxBranches: z.number().int().min(1).max(100),
		maxTags: z.number().int().min(0).max(500),
		/** Alternate branches prebuilt as walkable worlds (the current branch is the main world). */
		maxUniverses: z.number().int().min(0).max(8),
		maxReleases: z.number().int().min(0).max(100),
		/** A single file's diff in a single commit; larger diffs ship as "too-large". */
		maxDiffBytesPerFile: z
			.number()
			.int()
			.min(1024)
			.max(512 * 1024),
		/** history.json plus every history/commits/*.json file. Oldest diffs are dropped first. */
		maxTotalBytes: z
			.number()
			.int()
			.min(64 * 1024)
			.max(32 * 1024 * 1024),
		/** Every universes/<slug>/ bundle together; a universe that would overflow it stays history-only. */
		maxUniverseTotalBytes: z
			.number()
			.int()
			.min(0)
			.max(250 * 1024 * 1024),
		/** false skips the build-time GitHub releases/packages request for this world. */
		releases: z.boolean(),
	})
	.partial();
export type HistoryConfig = z.infer<typeof HistoryConfigSchema>;

export interface ResolvedHistoryCaps {
	maxCommitsPerBranch: number;
	maxBranches: number;
	maxTags: number;
	maxUniverses: number;
	maxReleases: number;
	maxDiffBytesPerFile: number;
	maxTotalBytes: number;
	maxUniverseTotalBytes: number;
}

export function resolveHistoryCaps(
	config: HistoryConfig | undefined,
): ResolvedHistoryCaps {
	return {
		maxCommitsPerBranch:
			config?.maxCommitsPerBranch ?? DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH,
		maxBranches: config?.maxBranches ?? DEFAULT_HISTORY_MAX_BRANCHES,
		maxTags: config?.maxTags ?? DEFAULT_HISTORY_MAX_TAGS,
		maxUniverses: config?.maxUniverses ?? DEFAULT_HISTORY_MAX_UNIVERSES,
		maxReleases: config?.maxReleases ?? DEFAULT_HISTORY_MAX_RELEASES,
		maxDiffBytesPerFile:
			config?.maxDiffBytesPerFile ?? DEFAULT_HISTORY_MAX_DIFF_BYTES_PER_FILE,
		maxTotalBytes: config?.maxTotalBytes ?? DEFAULT_HISTORY_MAX_TOTAL_BYTES,
		maxUniverseTotalBytes:
			config?.maxUniverseTotalBytes ?? DEFAULT_HISTORY_MAX_UNIVERSE_TOTAL_BYTES,
	};
}

const OidSchema = z.string().regex(/^[0-9a-f]{40}$/);

// Pinned to exactly what the converter writes, same reasoning as
// MEDIA_ASSET_PATTERN: the engine fetches these, so a hand-edited
// history.json must not be able to point it at another origin or up out of
// the bundle.
export const HISTORY_DIFF_FILE_PATTERN =
	/^history\/commits\/[0-9a-f]{40}\.json$/;
export const UNIVERSE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const UNIVERSE_WORLD_URL_PATTERN =
	/^universes\/[a-z0-9][a-z0-9-]{0,79}\/world\.json$/;

export function historyDiffFilePath(oid: string): string {
	return `history/commits/${oid}.json`;
}

export function universeWorldUrl(slug: string): string {
	return `universes/${slug}/world.json`;
}

const GithubUrlSchema = z
	.string()
	.max(2048)
	.refine((value) => {
		try {
			const url = new URL(value);
			return url.protocol === "https:" && url.hostname === "github.com";
		} catch {
			return false;
		}
	}, "must be an https://github.com/ url");

export const HISTORY_DIFF_STATES = [
	"included",
	/** Old or new version matched the leaked-secret detector. */
	"sealed-secret",
	/** Secret-pattern filename (.env, *.pem, ...): never shipped from any commit. */
	"sealed-path",
	"binary",
	"too-large",
	/** Dropped to fit maxTotalBytes (oldest first). */
	"omitted",
] as const;
export type HistoryDiffState = (typeof HISTORY_DIFF_STATES)[number];

export const HistoryChangeSchema = z.object({
	path: z.string().min(1).max(1024),
	status: z.enum(["added", "modified", "deleted"]),
	additions: z.number().int().nonnegative().optional(),
	deletions: z.number().int().nonnegative().optional(),
	diff: z.enum(HISTORY_DIFF_STATES),
});
export type HistoryChange = z.infer<typeof HistoryChangeSchema>;

export const MAX_HISTORY_CHANGES_PER_COMMIT = 300;
export const MAX_HISTORY_MESSAGE_CHARS = 4000;

export const HistoryCommitSchema = z.object({
	oid: OidSchema,
	parents: z.array(OidSchema).max(16),
	/** Author name only — emails are never shipped (a public page would hand them to scrapers). */
	author: z.string().max(200),
	/** Unix seconds. */
	time: z.number().int(),
	message: z.string().max(MAX_HISTORY_MESSAGE_CHARS),
	messageWithheld: z.literal(true).optional(),
	/** Changes against the first parent (all files, for a root commit). */
	changes: z.array(HistoryChangeSchema).max(MAX_HISTORY_CHANGES_PER_COMMIT),
	changesTruncated: z.literal(true).optional(),
	/** Present when at least one change's diff is "included". */
	diffFile: z.string().regex(HISTORY_DIFF_FILE_PATTERN).optional(),
});
export type HistoryCommit = z.infer<typeof HistoryCommitSchema>;

export const HistoryBranchSchema = z.object({
	name: z.string().min(1).max(255),
	head: OidSchema,
	/** The branch the main world was built from (the checked-out one). */
	current: z.boolean(),
	/** A remote-tracking branch (origin/...) with no local branch of the same name. */
	remote: z.boolean(),
	/** Newest first, capped at maxCommitsPerBranch; every oid is in `commits`. */
	commits: z.array(OidSchema),
	truncated: z.boolean(),
	/** Set only when this branch was prebuilt as a walkable world. */
	universe: z
		.object({
			slug: z.string().regex(UNIVERSE_SLUG_PATTERN),
			worldUrl: z.string().regex(UNIVERSE_WORLD_URL_PATTERN),
		})
		.optional(),
	/** Why an alternate branch has no world: over maxUniverses, or over maxUniverseTotalBytes. */
	universeSkipped: z.enum(["cap", "over-budget", "failed"]).optional(),
});
export type HistoryBranch = z.infer<typeof HistoryBranchSchema>;

export const HistoryTagSchema = z.object({
	name: z.string().min(1).max(255),
	/** The commit the tag points at (annotated tags peeled). */
	oid: OidSchema,
	annotated: z.boolean(),
	message: z.string().max(MAX_HISTORY_MESSAGE_CHARS).optional(),
	messageWithheld: z.literal(true).optional(),
	tagger: z.string().max(200).optional(),
	time: z.number().int().optional(),
});
export type HistoryTag = z.infer<typeof HistoryTagSchema>;

export const MAX_RELEASE_BODY_CHARS = 20_000;

export const HistoryReleaseAssetSchema = z.object({
	name: z.string().min(1).max(255),
	size: z.number().int().nonnegative(),
	downloadCount: z.number().int().nonnegative(),
	url: GithubUrlSchema,
});

export const HistoryReleaseSchema = z.object({
	tagName: z.string().min(1).max(255),
	name: z.string().max(255),
	/** GitHub-flavoured markdown as written; the engine renders a safe subset as React elements, never HTML. */
	body: z.string().max(MAX_RELEASE_BODY_CHARS),
	prerelease: z.boolean(),
	publishedAt: z.string().max(40).nullable(),
	url: GithubUrlSchema,
	assets: z.array(HistoryReleaseAssetSchema).max(50),
});
export type HistoryRelease = z.infer<typeof HistoryReleaseSchema>;

export const HistoryPackageSchema = z.object({
	name: z.string().min(1).max(255),
	packageType: z.string().max(40),
	url: GithubUrlSchema,
});
export type HistoryPackage = z.infer<typeof HistoryPackageSchema>;

export const HISTORY_RELEASE_SOURCES = [
	"github",
	/** Not a github.com repo, or cabn.json `history.releases: false`. */
	"none",
	/** `--offline`, or a host that never fetches (convert() without a fetch). */
	"offline",
	/** The request failed or was rate-limited; the build carried on without releases. */
	"unavailable",
] as const;

export const HistoryIndexFileSchema = z.object({
	historyVersion: z.literal(HISTORY_INDEX_VERSION),
	head: z.object({
		/** null for a detached HEAD. */
		branch: z.string().max(255).nullable(),
		oid: OidSchema,
	}),
	commits: z.array(HistoryCommitSchema),
	branches: z.array(HistoryBranchSchema),
	tags: z.array(HistoryTagSchema),
	releases: z.object({
		source: z.enum(HISTORY_RELEASE_SOURCES),
		repo: z
			.object({
				owner: z.string().max(100),
				name: z.string().max(100),
				url: GithubUrlSchema,
			})
			.optional(),
		items: z.array(HistoryReleaseSchema),
		packages: z.array(HistoryPackageSchema),
	}),
	/** Main-world paths whose shipped content differs from HEAD (uncommitted edits, untracked files). */
	dirtyPaths: z.array(z.string().max(1024)),
	truncated: z.object({
		branches: z.boolean(),
		tags: z.boolean(),
		/** Diffs dropped as "omitted" to fit maxTotalBytes. */
		omittedDiffs: z.number().int().nonnegative(),
	}),
});
export type HistoryIndexFile = z.infer<typeof HistoryIndexFileSchema>;

export const HistoryHunkSchema = z.object({
	oldStart: z.number().int().nonnegative(),
	oldLines: z.number().int().nonnegative(),
	newStart: z.number().int().nonnegative(),
	newLines: z.number().int().nonnegative(),
	/** Each line prefixed " ", "+" or "-". */
	lines: z.array(z.string()),
});
export type HistoryHunk = z.infer<typeof HistoryHunkSchema>;

export const HistoryCommitDiffFileSchema = z.object({
	historyVersion: z.literal(HISTORY_INDEX_VERSION),
	oid: OidSchema,
	files: z.array(
		z.object({
			path: z.string().min(1).max(1024),
			hunks: z.array(HistoryHunkSchema),
		}),
	),
});
export type HistoryCommitDiffFile = z.infer<typeof HistoryCommitDiffFileSchema>;

/** Engine-side reader: never throws. Missing, garbled or future-version files mean "no history". */
export function parseHistoryIndex(json: unknown): HistoryIndexFile | null {
	const parsed = HistoryIndexFileSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

export function parseHistoryCommitDiff(
	json: unknown,
): HistoryCommitDiffFile | null {
	const parsed = HistoryCommitDiffFileSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}
