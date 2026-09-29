import { z } from "zod";

/**
 * Git history ships as a small, real, read-only git directory beside the
 * bundle — `git/` (HEAD, config, packed-refs, shallow, one pack + index) —
 * which the engine reads in the browser with isomorphic-git, plus
 * `git/files.json` (the exact files there, since static hosts can't list a
 * directory), `git/meta.json` (branch/tag summaries so the rift can draw
 * before the pack loads) and `releases.json` (GitHub releases, fetched once
 * at build time). All of it is additive: world.json is unchanged,
 * CABN_VERSION stays 1, and engines from before it never request these.
 *
 * The objects are the repository's own, byte for byte — real hashes, author
 * and committer names and emails, signatures. The only objects left out are
 * blobs the trees still point at: secret-named files (the converter's
 * secret patterns: .env, *.pem, ...), blobs over the per-blob cap, and
 * files in folders the world ignores. A reader sees those as "not shipped".
 */
export const GIT_DIR = "git/";
export const GIT_FORMAT_VERSION = 1;
export const GIT_FILES_FILENAME = "git/files.json";
export const GIT_META_FILENAME = "git/meta.json";
export const RELEASES_FILENAME = "releases.json";
export const RELEASES_VERSION = 1;

export const DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH = 200;
export const DEFAULT_HISTORY_MAX_BRANCHES = 20;
export const DEFAULT_HISTORY_MAX_TAGS = 50;
export const DEFAULT_HISTORY_MAX_RELEASES = 10;
export const DEFAULT_HISTORY_MAX_PACK_BYTES = 20 * 1024 * 1024;
export const DEFAULT_HISTORY_MAX_BLOB_BYTES = 2 * 1024 * 1024;
/** meta.json lists at most this many omitted blobs; the rest are still "not shipped", just without a recorded reason. */
export const MAX_OMITTED_BLOB_RECORDS = 20_000;

/** cabn.json `history`: every field optional and bounded, so a hand-edited value can't ask for an unbounded bundle. */
export const HistoryConfigSchema = z
	.strictObject({
		/** false: no git/ directory and no releases fetch. */
		enabled: z.boolean(),
		/** The shallow boundary per branch before halving to fit maxPackBytes. */
		maxCommitsPerBranch: z.number().int().min(1).max(1000),
		maxBranches: z.number().int().min(1).max(100),
		maxTags: z.number().int().min(0).max(500),
		maxReleases: z.number().int().min(0).max(100),
		/** The whole pack. Over it, the per-branch boundary halves until it fits (recorded in meta.json). */
		maxPackBytes: z
			.number()
			.int()
			.min(1024 * 1024)
			.max(200 * 1024 * 1024),
		/** A blob larger than this stays out of the pack ("not shipped"). */
		maxBlobBytes: z
			.number()
			.int()
			.min(16 * 1024)
			.max(25 * 1024 * 1024),
		/** false skips the build-time GitHub releases/packages request for this world. */
		releases: z.boolean(),
	})
	.partial();
export type HistoryConfig = z.infer<typeof HistoryConfigSchema>;

export interface ResolvedHistoryCaps {
	maxCommitsPerBranch: number;
	maxBranches: number;
	maxTags: number;
	maxReleases: number;
	maxPackBytes: number;
	maxBlobBytes: number;
}

export function resolveHistoryCaps(
	config: HistoryConfig | undefined,
): ResolvedHistoryCaps {
	return {
		maxCommitsPerBranch:
			config?.maxCommitsPerBranch ?? DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH,
		maxBranches: config?.maxBranches ?? DEFAULT_HISTORY_MAX_BRANCHES,
		maxTags: config?.maxTags ?? DEFAULT_HISTORY_MAX_TAGS,
		maxReleases: config?.maxReleases ?? DEFAULT_HISTORY_MAX_RELEASES,
		maxPackBytes: config?.maxPackBytes ?? DEFAULT_HISTORY_MAX_PACK_BYTES,
		maxBlobBytes: config?.maxBlobBytes ?? DEFAULT_HISTORY_MAX_BLOB_BYTES,
	};
}

const OidSchema = z.string().regex(/^[0-9a-f]{40}$/);

// Pinned to exactly what the converter writes, same reasoning as
// MEDIA_ASSET_PATTERN: the engine's read-only fs fetches only these, so a
// hand-edited files.json can't point it at another origin or out of git/.
export const GIT_FILE_PATTERN =
	/^(HEAD|config|packed-refs|shallow|objects\/pack\/pack-[0-9a-f]{40}\.(pack|idx))$/;

export const GitFilesSchema = z.object({
	gitVersion: z.literal(GIT_FORMAT_VERSION),
	/** Paths relative to git/, each fetchable as `<world>/git/<path>`. */
	files: z.array(z.string().regex(GIT_FILE_PATTERN)).max(16),
});
export type GitFiles = z.infer<typeof GitFilesSchema>;

export const GitBranchSummarySchema = z.object({
	name: z.string().min(1).max(255),
	/** The full ref in packed-refs (refs/heads/... or refs/remotes/origin/...). */
	ref: z.string().min(1).max(300),
	head: OidSchema,
	/** The branch the main world was built from (the checked-out one). */
	current: z.boolean(),
	remote: z.boolean(),
	/** Commits of this branch inside the pack (the shallow boundary). */
	commits: z.number().int().nonnegative(),
	/** True when older commits exist past the boundary. */
	truncated: z.boolean(),
	subject: z.string().max(500),
	author: z.string().max(200),
	time: z.number().int(),
});
export type GitBranchSummary = z.infer<typeof GitBranchSummarySchema>;

export const GitTagSummarySchema = z.object({
	name: z.string().min(1).max(255),
	/** The commit the tag points at (annotated tags peeled). */
	oid: OidSchema,
	annotated: z.boolean(),
	message: z.string().max(4000).optional(),
	tagger: z.string().max(200).optional(),
	time: z.number().int().optional(),
});
export type GitTagSummary = z.infer<typeof GitTagSummarySchema>;

export const OMITTED_BLOB_REASONS = [
	"secret-name",
	"too-large",
	"ignored",
	"pack-cap",
] as const;
export type OmittedBlobReason = (typeof OMITTED_BLOB_REASONS)[number];

export const GitMetaSchema = z.object({
	gitVersion: z.literal(GIT_FORMAT_VERSION),
	head: z.object({
		/** null for a detached HEAD. */
		branch: z.string().max(255).nullable(),
		oid: OidSchema,
	}),
	/** Current branch first, then most recently active. */
	branches: z.array(GitBranchSummarySchema),
	tags: z.array(GitTagSummarySchema),
	pack: z.object({
		bytes: z.number().int().nonnegative(),
		objects: z.number().int().nonnegative(),
		/** The per-branch boundary actually used. */
		commitsPerBranch: z.number().int().positive(),
		/** How many times the boundary was halved to fit maxPackBytes. */
		halvings: z.number().int().nonnegative(),
	}),
	/** Blob oid -> why it isn't in the pack and how big it is. */
	omitted: z.record(
		OidSchema,
		z.object({
			reason: z.enum(OMITTED_BLOB_REASONS),
			size: z.number().int().nonnegative(),
		}),
	),
	truncated: z.object({ branches: z.boolean(), tags: z.boolean() }),
});
export type GitMeta = z.infer<typeof GitMetaSchema>;

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

export const ReleasesFileSchema = z.object({
	releasesVersion: z.literal(RELEASES_VERSION),
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
});
export type ReleasesFile = z.infer<typeof ReleasesFileSchema>;

/** Engine-side readers: never throw. Missing, garbled or future-version files mean "no history". */
export function parseGitMeta(json: unknown): GitMeta | null {
	const parsed = GitMetaSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

export function parseGitFiles(json: unknown): GitFiles | null {
	const parsed = GitFilesSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

export function parseReleasesFile(json: unknown): ReleasesFile | null {
	const parsed = ReleasesFileSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}
