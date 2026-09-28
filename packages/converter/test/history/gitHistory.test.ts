import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type HistoryIndexFile,
	parseHistoryCommitDiff,
	parseHistoryIndex,
	type WorldManifest,
} from "@cabn/world-schema";
import * as git from "isomorphic-git";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { convert, type WorldBundle } from "../../src/convert.js";
import { reverseApplyHunks } from "../../src/history/diff.js";
import type { GithubFetch } from "../../src/history/githubReleases.js";
import { DirSource } from "../../src/sources/dir.js";
import {
	AUTHOR_EMAIL,
	createFixtureRepo,
	createStandardFixture,
	ENV_SECRET_VALUE,
	FAKE_ANTHROPIC_KEY,
	FAKE_AWS_KEY,
	type FixtureRepo,
} from "./fixtureRepo.js";

const NOW = () => new Date("2026-09-28T00:00:00.000Z");

async function convertRepo(
	repo: FixtureRepo,
	extra: Partial<Parameters<typeof convert>[1]> = {},
): Promise<WorldBundle> {
	return convert(new DirSource(repo.dir), {
		name: "garden",
		source: repo.dir,
		now: NOW,
		git: { fs, dir: repo.dir },
		...extra,
	});
}

function historyOf(bundle: WorldBundle): HistoryIndexFile {
	const raw = bundle.get("history.json");
	if (typeof raw !== "string") throw new Error("no history.json");
	const parsed = parseHistoryIndex(JSON.parse(raw));
	if (!parsed) throw new Error("history.json failed its own schema");
	return parsed;
}

function allText(bundle: WorldBundle): string {
	const decoder = new TextDecoder();
	return [...bundle.values()]
		.map((v) => (typeof v === "string" ? v : decoder.decode(v)))
		.join("\n");
}

function commitBySubject(history: HistoryIndexFile, subject: string) {
	const commit = history.commits.find((c) => c.message.startsWith(subject));
	if (!commit) throw new Error(`no commit "${subject}"`);
	return commit;
}

describe("git history in the bundle", () => {
	let repo: FixtureRepo;
	let bundle: WorldBundle;
	let history: HistoryIndexFile;

	beforeAll(async () => {
		repo = await createStandardFixture();
		bundle = await convertRepo(repo);
		history = historyOf(bundle);
		return () => repo.cleanup();
	});

	test("lists branches (current first), tags and the head", () => {
		expect(history.head.branch).toBe("main");
		expect(history.branches.map((b) => b.name)).toEqual([
			"main",
			"feature/lanterns",
		]);
		expect(history.branches[0]?.current).toBe(true);
		expect(history.branches[0]?.commits).toHaveLength(4);
		expect(history.branches[1]?.commits).toHaveLength(5);
		expect(history.tags.map((t) => t.name).sort()).toEqual([
			"v0.1.0",
			"v0.2.0",
		]);
		const annotated = history.tags.find((t) => t.name === "v0.2.0");
		expect(annotated).toMatchObject({
			annotated: true,
			message: "Second harvest",
			tagger: "Wren Hollow",
		});
		expect(history.commits).toHaveLength(5);
	});

	test("never ships author emails", () => {
		expect(allText(bundle)).not.toContain(AUTHOR_EMAIL);
		expect(history.commits[0]?.author).toBe("Wren Hollow");
	});

	test("secret-pattern files are never shipped from any commit", () => {
		const planted = commitBySubject(history, "Plant");
		expect(planted.changes.find((c) => c.path === ".env")).toMatchObject({
			status: "added",
			diff: "sealed-path",
		});
		expect(allText(bundle)).not.toContain(ENV_SECRET_VALUE);
	});

	test("a secret deleted later is withheld from every diff that would show it", () => {
		const added = commitBySubject(history, "Water");
		const removed = commitBySubject(history, "(message withheld");
		expect(added.changes.find((c) => c.path === "src/config.js")?.diff).toBe(
			"sealed-secret",
		);
		expect(removed.changes.find((c) => c.path === "src/config.js")?.diff).toBe(
			"sealed-secret",
		);
		expect(allText(bundle)).not.toContain(FAKE_AWS_KEY);
	});

	test("a commit message holding a secret is withheld", () => {
		const removed = commitBySubject(history, "(message withheld");
		expect(removed.messageWithheld).toBe(true);
		expect(allText(bundle)).not.toContain(FAKE_ANTHROPIC_KEY);
	});

	test("ignored directories never appear", () => {
		const notes = commitBySubject(history, "Add notes");
		expect(notes.changes.map((c) => c.path)).toEqual(["notes.md"]);
	});

	test("included diffs round-trip back to the old version", () => {
		const watered = commitBySubject(history, "Water");
		expect(watered.diffFile).toBe(`history/commits/${watered.oid}.json`);
		const change = watered.changes.find((c) => c.path === "src/app.js");
		expect(change).toMatchObject({
			diff: "included",
			additions: 5,
			deletions: 1,
		});
		const raw = bundle.get(watered.diffFile as string);
		const diff = parseHistoryCommitDiff(JSON.parse(raw as string));
		const hunks = diff?.files.find((f) => f.path === "src/app.js")?.hunks ?? [];
		const newText =
			"export function grow() {\n\treturn 2;\n}\n\nexport function water() {\n\treturn true;\n}\n";
		expect(reverseApplyHunks(newText, hunks)).toBe(
			"export function grow() {\n\treturn 1;\n}\n",
		);
	});

	test("the other branch is prebuilt as a universe with its own source and sealed secrets", () => {
		const feature = history.branches.find((b) => b.name === "feature/lanterns");
		expect(feature?.universe?.worldUrl).toMatch(
			/^universes\/feature-lanterns-[0-9a-f]{6}\/world\.json$/,
		);
		const worldUrl = feature?.universe?.worldUrl as string;
		const manifest = JSON.parse(
			bundle.get(worldUrl) as string,
		) as WorldManifest;
		expect(manifest.meta.source).toBe(`${repo.dir}#feature/lanterns`);
		const paths = manifest.portals.map((p) => p.id).sort();
		expect(paths).toContain("lanterns.md");
		expect(paths).toContain("src/secret.js");
		const secretPortal = manifest.portals.find((p) => p.id === "src/secret.js");
		expect(secretPortal?.richPreview).toEqual({ kind: "sealed" });
	});

	test("the main world is untouched: world.json keeps its shape and version", () => {
		const manifest = JSON.parse(
			bundle.get("world.json") as string,
		) as WorldManifest;
		expect(manifest.cabnVersion).toBe(1);
		expect(Object.keys(manifest)).not.toContain("history");
	});

	test("releases are 'offline' when no fetch is given and 'none' without a github remote", () => {
		expect(history.releases.source).toBe("none");
	});
});

describe("git history options and caps", () => {
	const repos: FixtureRepo[] = [];
	afterEach(async () => {
		for (const r of repos.splice(0)) await r.cleanup();
	});

	async function standard(): Promise<FixtureRepo> {
		const repo = await createStandardFixture();
		repos.push(repo);
		return repo;
	}

	test("a directory that isn't a repository root gets no history", async () => {
		const repo = await standard();
		const bundle = await convert(new DirSource(join(repo.dir, "src")), {
			name: "src",
			source: "src",
			now: NOW,
			git: { fs, dir: join(repo.dir, "src") },
		});
		expect(bundle.has("history.json")).toBe(false);
	});

	test("cabn.json history.enabled=false turns it off", async () => {
		const repo = await standard();
		await writeFile(
			join(repo.dir, "cabn.json"),
			JSON.stringify({ cabnConfigVersion: 1, history: { enabled: false } }),
		);
		const bundle = await convertRepo(repo);
		expect(bundle.has("history.json")).toBe(false);
		expect([...bundle.keys()].some((k) => k.startsWith("universes/"))).toBe(
			false,
		);
	});

	test("maxCommitsPerBranch truncates, maxUniverses=0 builds no universes", async () => {
		const repo = await standard();
		await writeFile(
			join(repo.dir, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				history: { maxCommitsPerBranch: 2, maxUniverses: 0 },
			}),
		);
		const history = historyOf(await convertRepo(repo));
		const main = history.branches[0];
		expect(main?.commits).toHaveLength(2);
		expect(main?.truncated).toBe(true);
		expect(history.branches[1]?.universeSkipped).toBe("cap");
		expect(history.branches[1]?.universe).toBeUndefined();
	});

	test("maxTotalBytes drops the oldest diffs first", async () => {
		const repo = await createFixtureRepo();
		repos.push(repo);
		const big = (n: number) =>
			Array.from(
				{ length: 300 },
				(_, i) => `line ${i} version ${n} ${"x".repeat(40)}`,
			).join("\n");
		for (let n = 0; n < 6; n++) {
			await repo.commit({ "data.txt": `${big(n)}\n` }, `rev ${n}`, n);
		}
		await writeFile(
			join(repo.dir, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				history: { maxTotalBytes: 128 * 1024, maxDiffBytesPerFile: 128 * 1024 },
			}),
		);
		const bundle = await convertRepo(repo);
		const history = historyOf(bundle);
		const historyBytes = [...bundle]
			.filter(([k]) => k === "history.json" || k.startsWith("history/"))
			.reduce((n, [, v]) => n + (v as string).length, 0);
		expect(historyBytes).toBeLessThanOrEqual(128 * 1024);
		expect(history.truncated.omittedDiffs).toBeGreaterThan(0);
		const newest = history.commits[0];
		const oldest = history.commits[history.commits.length - 1];
		expect(newest?.changes[0]?.diff).toBe("included");
		expect(oldest?.changes[0]?.diff).toBe("omitted");
	});

	test("maxDiffBytesPerFile marks a big diff too-large", async () => {
		const repo = await standard();
		await repo.commit(
			{
				"big.txt": `${Array.from({ length: 400 }, (_, i) => `row ${i}`).join("\n")}\n`,
			},
			"Add big file",
			5,
		);
		await writeFile(
			join(repo.dir, "cabn.json"),
			JSON.stringify({
				cabnConfigVersion: 1,
				history: { maxDiffBytesPerFile: 1024 },
			}),
		);
		const history = historyOf(await convertRepo(repo));
		expect(commitBySubject(history, "Add big").changes[0]).toMatchObject({
			path: "big.txt",
			diff: "too-large",
			additions: 400,
		});
	});

	test("uncommitted edits show up in dirtyPaths", async () => {
		const repo = await standard();
		await writeFile(join(repo.dir, "notes.md"), "# Notes\n\n- edited\n");
		const history = historyOf(await convertRepo(repo));
		expect(history.dirtyPaths).toEqual(["notes.md"]);
	});

	test("a github remote with no fetch records releases as offline; a fetch fills them", async () => {
		const repo = await standard();
		await git.addRemote({
			fs,
			dir: repo.dir,
			remote: "origin",
			url: "git@github.com:wren/lantern-garden.git",
		});
		expect(historyOf(await convertRepo(repo)).releases).toMatchObject({
			source: "offline",
			repo: { owner: "wren", name: "lantern-garden" },
		});

		const requested: string[] = [];
		const fetch: GithubFetch = async (url) => {
			requested.push(url);
			return {
				ok: true,
				status: 200,
				json: async () => [
					{
						tag_name: "v0.2.0",
						name: "Second harvest",
						body: "## Notes\n- **new** lanterns",
						draft: false,
						prerelease: false,
						published_at: "2026-06-02T09:00:00Z",
						html_url:
							"https://github.com/wren/lantern-garden/releases/tag/v0.2.0",
						assets: [
							{
								name: "garden.zip",
								size: 1234,
								download_count: 3,
								browser_download_url:
									"https://github.com/wren/lantern-garden/releases/download/v0.2.0/garden.zip",
							},
						],
					},
					{
						tag_name: "draft",
						draft: true,
						html_url: "https://github.com/x/y",
					},
					{
						tag_name: "evil",
						html_url: "https://evil.example/phish",
						assets: [],
					},
				],
			};
		};
		const releases = historyOf(
			await convertRepo(repo, {
				git: { fs, dir: repo.dir, github: { fetch } },
			}),
		).releases;
		expect(requested).toEqual([
			"https://api.github.com/repos/wren/lantern-garden/releases?per_page=10",
		]);
		expect(releases.source).toBe("github");
		expect(releases.items.map((r) => r.tagName)).toEqual(["v0.2.0"]);
		expect(releases.items[0]?.assets[0]?.name).toBe("garden.zip");
	});

	test("a failing releases request doesn't fail the build", async () => {
		const repo = await standard();
		await git.addRemote({
			fs,
			dir: repo.dir,
			remote: "origin",
			url: "https://github.com/wren/lantern-garden",
		});
		const fetch: GithubFetch = async () => ({
			ok: false,
			status: 403,
			json: async () => ({}),
		});
		const history = historyOf(
			await convertRepo(repo, {
				git: { fs, dir: repo.dir, github: { fetch } },
			}),
		);
		expect(history.releases.source).toBe("unavailable");
	});

	test("an unreadable .git pointer warns and skips history", async () => {
		const repo = await createFixtureRepo();
		repos.push(repo);
		await repo.commit({ "a.txt": "a\n" }, "a", 0);
		const other = await createFixtureRepo();
		repos.push(other);
		await writeFile(join(other.dir, "b.txt"), "b\n");
		await fs.promises.rm(join(other.dir, ".git"), { recursive: true });
		await writeFile(
			join(other.dir, ".git"),
			"gitdir: /nonexistent/worktrees/x\n",
		);
		const warnings: string[] = [];
		const bundle = await convert(new DirSource(other.dir), {
			name: "b",
			source: other.dir,
			now: NOW,
			git: { fs, dir: other.dir },
			onWarning: (m) => warnings.push(m),
		});
		expect(bundle.has("history.json")).toBe(false);
		expect(warnings.join("\n")).toMatch(/git history skipped/);
	});
});
