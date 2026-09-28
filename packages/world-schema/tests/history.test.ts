import { describe, expect, test } from "vitest";
import {
	CabnConfigSchema,
	DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH,
	HISTORY_INDEX_VERSION,
	parseHistoryCommitDiff,
	parseHistoryIndex,
	resolveHistoryCaps,
} from "../src/index.js";

const oid = "a".repeat(40);

function index(overrides: Record<string, unknown> = {}) {
	return {
		historyVersion: HISTORY_INDEX_VERSION,
		head: { branch: "main", oid },
		commits: [
			{
				oid,
				parents: [],
				author: "Wren",
				time: 1780000000,
				message: "Plant",
				changes: [{ path: "a.md", status: "added", diff: "included" }],
				diffFile: `history/commits/${oid}.json`,
			},
		],
		branches: [
			{
				name: "main",
				head: oid,
				current: true,
				remote: false,
				commits: [oid],
				truncated: false,
			},
		],
		tags: [],
		releases: { source: "none", items: [], packages: [] },
		dirtyPaths: [],
		truncated: { branches: false, tags: false, omittedDiffs: 0 },
		...overrides,
	};
}

describe("history.json", () => {
	test("parses what the converter writes", () => {
		expect(parseHistoryIndex(index())?.head.branch).toBe("main");
	});

	test("rejects a future version and garbage instead of throwing", () => {
		expect(parseHistoryIndex(index({ historyVersion: 2 }))).toBeNull();
		expect(parseHistoryIndex("nope")).toBeNull();
		expect(parseHistoryIndex(null)).toBeNull();
	});

	test("pins fetched paths to the bundle", () => {
		const commits = index().commits;
		const evil = [{ ...commits[0], diffFile: "https://evil.example/x.json" }];
		expect(parseHistoryIndex(index({ commits: evil }))).toBeNull();
		const upward = [{ ...commits[0], diffFile: "../history/commits/x.json" }];
		expect(parseHistoryIndex(index({ commits: upward }))).toBeNull();
		const branch = {
			...index().branches[0],
			universe: { slug: "x", worldUrl: "//evil.example/world.json" },
		};
		expect(parseHistoryIndex(index({ branches: [branch] }))).toBeNull();
	});

	test("release links must be https://github.com/", () => {
		const release = {
			tagName: "v1",
			name: "One",
			body: "",
			prerelease: false,
			publishedAt: null,
			url: "javascript:alert(1)",
			assets: [],
		};
		const releases = { source: "github", items: [release], packages: [] };
		expect(parseHistoryIndex(index({ releases }))).toBeNull();
		release.url = "https://github.com/wren/garden/releases/tag/v1";
		expect(parseHistoryIndex(index({ releases }))).not.toBeNull();
	});

	test("commit diff files", () => {
		expect(
			parseHistoryCommitDiff({
				historyVersion: 1,
				oid,
				files: [
					{
						path: "a.md",
						hunks: [
							{
								oldStart: 0,
								oldLines: 0,
								newStart: 1,
								newLines: 1,
								lines: ["+a"],
							},
						],
					},
				],
			}),
		).not.toBeNull();
		expect(
			parseHistoryCommitDiff({ historyVersion: 1, oid: "x", files: [] }),
		).toBeNull();
	});
});

describe("cabn.json history", () => {
	test("defaults and bounds", () => {
		expect(resolveHistoryCaps(undefined).maxCommitsPerBranch).toBe(
			DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH,
		);
		const ok = CabnConfigSchema.safeParse({
			cabnConfigVersion: 1,
			history: { maxCommitsPerBranch: 50, maxUniverses: 0, releases: false },
		});
		expect(ok.success).toBe(true);
		for (const bad of [
			{ maxCommitsPerBranch: 0 },
			{ maxCommitsPerBranch: 5000 },
			{ maxUniverses: 9 },
			{ maxTotalBytes: 1 },
			{ maxDiffBytesPerFile: 10 * 1024 * 1024 },
			{ unknownKey: true },
		]) {
			expect(
				CabnConfigSchema.safeParse({ cabnConfigVersion: 1, history: bad })
					.success,
			).toBe(false);
		}
	});
});
