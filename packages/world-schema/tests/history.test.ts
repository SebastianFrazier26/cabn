import { describe, expect, test } from "vitest";
import {
	CabnConfigSchema,
	DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH,
	GIT_FORMAT_VERSION,
	parseGitFiles,
	parseGitMeta,
	parseReleasesFile,
	resolveHistoryCaps,
} from "../src/index.js";

const oid = "a".repeat(40);

function meta(overrides: Record<string, unknown> = {}) {
	return {
		gitVersion: GIT_FORMAT_VERSION,
		head: { branch: "main", oid },
		branches: [
			{
				name: "main",
				ref: "refs/heads/main",
				head: oid,
				current: true,
				remote: false,
				commits: 3,
				truncated: false,
				subject: "Plant",
				author: "Wren",
				time: 1780000000,
			},
		],
		tags: [],
		pack: { bytes: 100, objects: 5, commitsPerBranch: 200, halvings: 0 },
		omitted: { [oid]: { reason: "secret-name", size: 12 } },
		truncated: { branches: false, tags: false },
		...overrides,
	};
}

describe("git/meta.json", () => {
	test("parses what the converter writes; rejects garbage and future versions", () => {
		expect(parseGitMeta(meta())?.head.branch).toBe("main");
		expect(parseGitMeta(meta({ gitVersion: 2 }))).toBeNull();
		expect(parseGitMeta("nope")).toBeNull();
		expect(
			parseGitMeta(
				meta({ omitted: { [oid]: { reason: "because", size: 1 } } }),
			),
		).toBeNull();
	});
});

describe("git/files.json", () => {
	test("only the exact git files the converter writes", () => {
		const name = "b".repeat(40);
		expect(
			parseGitFiles({
				gitVersion: 1,
				files: [
					"HEAD",
					"config",
					"packed-refs",
					"shallow",
					`objects/pack/pack-${name}.pack`,
					`objects/pack/pack-${name}.idx`,
				],
			}),
		).not.toBeNull();
		for (const bad of [
			"../world.json",
			"//evil.example/x",
			"objects/ab/cdef",
			"refs/heads/main",
			"https://evil.example/pack",
			`objects/pack/pack-${name}.pack/../../x`,
		])
			expect(parseGitFiles({ gitVersion: 1, files: [bad] }), bad).toBeNull();
	});
});

describe("releases.json", () => {
	test("links must be https://github.com/", () => {
		const release = {
			tagName: "v1",
			name: "One",
			body: "",
			prerelease: false,
			publishedAt: null,
			url: "javascript:alert(1)",
			assets: [],
		};
		const file = {
			releasesVersion: 1,
			source: "github",
			items: [release],
			packages: [],
		};
		expect(parseReleasesFile(file)).toBeNull();
		release.url = "https://github.com/wren/garden/releases/tag/v1";
		expect(parseReleasesFile(file)).not.toBeNull();
	});
});

describe("cabn.json history", () => {
	test("defaults and bounds", () => {
		expect(resolveHistoryCaps(undefined).maxCommitsPerBranch).toBe(
			DEFAULT_HISTORY_MAX_COMMITS_PER_BRANCH,
		);
		expect(
			CabnConfigSchema.safeParse({
				cabnConfigVersion: 1,
				history: {
					maxCommitsPerBranch: 50,
					maxPackBytes: 5 * 1024 * 1024,
					releases: false,
				},
			}).success,
		).toBe(true);
		for (const bad of [
			{ maxCommitsPerBranch: 0 },
			{ maxPackBytes: 1024 },
			{ maxPackBytes: 1024 * 1024 * 1024 },
			{ maxBlobBytes: 100 },
			{ maxUniverses: 3 },
			{ unknownKey: true },
		])
			expect(
				CabnConfigSchema.safeParse({ cabnConfigVersion: 1, history: bad })
					.success,
			).toBe(false);
	});
});
