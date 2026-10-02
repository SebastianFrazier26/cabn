import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type GitMeta,
	parseGitFiles,
	parseGitMeta,
	parseReleasesFile,
	type WorldManifest,
} from "@cabn/world-schema";
import * as git from "isomorphic-git";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { convert, type WorldBundle } from "../../src/convert.js";
import type { GithubFetch } from "../../src/history/githubReleases.js";
import { GitTreeSource, type OpenedRepo } from "../../src/history/gitRepo.js";
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
const decoder = new TextDecoder();

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

function metaOf(bundle: WorldBundle): GitMeta {
	const parsed = parseGitMeta(
		JSON.parse(bundle.get("git/meta.json") as string),
	);
	if (!parsed) throw new Error("git/meta.json failed its own schema");
	return parsed;
}

/** Writes the bundle's git/ files to disk so isomorphic-git (and real git) can read them like any bare repository. */
async function materialize(bundle: WorldBundle): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "cabn-shipped-git-"));
	const files = parseGitFiles(
		JSON.parse(bundle.get("git/files.json") as string),
	);
	if (!files) throw new Error("git/files.json failed its own schema");
	for (const rel of files.files) {
		const value = bundle.get(`git/${rel}`);
		if (value === undefined)
			throw new Error(`files.json lists missing git/${rel}`);
		await mkdir(dirname(join(dir, rel)), { recursive: true });
		await writeFile(join(dir, rel), value);
	}
	return dir;
}

function systemGit(): boolean {
	try {
		execFileSync("git", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

describe("the shipped git directory", () => {
	let repo: FixtureRepo;
	let bundle: WorldBundle;
	let shipped: string;
	let meta: GitMeta;

	beforeAll(async () => {
		repo = await createStandardFixture();
		bundle = await convertRepo(repo);
		shipped = await materialize(bundle);
		meta = metaOf(bundle);
	});
	afterAll(async () => {
		await repo.cleanup();
		await rm(shipped, { recursive: true, force: true });
	});

	test("files.json lists exactly the git files, and the bundle adds nothing else to world.json", () => {
		const files = parseGitFiles(
			JSON.parse(bundle.get("git/files.json") as string),
		);
		expect(files?.files).toEqual(
			expect.arrayContaining(["HEAD", "config", "packed-refs"]),
		);
		expect(
			files?.files.filter((f) => f.startsWith("objects/pack/")),
		).toHaveLength(2);
		const manifest = JSON.parse(
			bundle.get("world.json") as string,
		) as WorldManifest;
		expect(manifest.cabnVersion).toBe(1);
		expect([...bundle.keys()].some((k) => k.startsWith("universes/"))).toBe(
			false,
		);
		expect(bundle.has("history.json")).toBe(false);
	});

	test("it is a real repository: same commit ids, full author identity, readable by isomorphic-git", async () => {
		const sourceLog = await git.log({ fs, dir: repo.dir, ref: "main" });
		const shippedLog = await git.log({ fs, gitdir: shipped, ref: "main" });
		expect(shippedLog.map((c) => c.oid)).toEqual(sourceLog.map((c) => c.oid));
		expect(shippedLog[0]?.commit.author.email).toBe(AUTHOR_EMAIL);
		expect(await git.currentBranch({ fs, gitdir: shipped })).toBe("main");
		expect((await git.listBranches({ fs, gitdir: shipped })).sort()).toEqual([
			"feature/lanterns",
			"main",
		]);
		expect((await git.listTags({ fs, gitdir: shipped })).sort()).toEqual([
			"v0.1.0",
			"v0.2.0",
		]);
		const tagOid = await git.resolveRef({
			fs,
			gitdir: shipped,
			ref: "refs/tags/v0.2.0",
		});
		expect(
			(await git.readTag({ fs, gitdir: shipped, oid: tagOid })).tag.message,
		).toBe("Second harvest\n");
	});

	test("a tracked file with a key in its text is not shipped; its clean later version is", async () => {
		const log = await git.log({ fs, gitdir: shipped, ref: "main" });
		const configOid = async (subject: string) => {
			const c = log.find((e) => e.commit.message.startsWith(subject));
			const tree = await git.readTree({
				fs,
				gitdir: shipped,
				oid: c?.commit.tree as string,
				filepath: "src",
			});
			return tree.tree.find((e) => e.path === "config.js")?.oid as string;
		};
		const leaky = await configOid("Water");
		await expect(
			git.readBlob({ fs, gitdir: shipped, oid: leaky }),
		).rejects.toThrow();
		expect(meta.omitted[leaky]).toMatchObject({ reason: "secret-name" });
		const { blob } = await git.readBlob({
			fs,
			gitdir: shipped,
			oid: await configOid("Rotate"),
		});
		expect(decoder.decode(blob)).toContain("process.env.AWS_KEY");
		for (const [key, value] of bundle)
			if (key.startsWith("git/") && value instanceof Uint8Array)
				expect(Buffer.from(value).includes(FAKE_AWS_KEY), key).toBe(false);
	});

	test("secret-named files are not shipped from any commit; their trees still point at them", async () => {
		const planted = (await git.log({ fs, gitdir: shipped, ref: "main" })).find(
			(c) => c.commit.message.startsWith("Plant"),
		);
		const tree = await git.readTree({
			fs,
			gitdir: shipped,
			oid: planted?.commit.tree as string,
		});
		const env = tree.tree.find((e) => e.path === ".env");
		expect(env).toBeDefined();
		await expect(
			git.readBlob({ fs, gitdir: shipped, oid: env?.oid as string }),
		).rejects.toThrow();
		expect(meta.omitted[env?.oid as string]).toMatchObject({
			reason: "secret-name",
		});
		const packs = [...bundle.entries()].filter(([k]) => k.endsWith(".pack"));
		expect(decoder.decode(packs[0]?.[1] as Uint8Array)).not.toContain(
			ENV_SECRET_VALUE,
		);
	});

	test("ignored folders are left out of the pack", async () => {
		const notes = (await git.log({ fs, gitdir: shipped, ref: "main" })).find(
			(c) => c.commit.message.startsWith("Add notes"),
		);
		const tree = await git.readTree({
			fs,
			gitdir: shipped,
			oid: notes?.commit.tree as string,
		});
		const nm = tree.tree.find((e) => e.path === "node_modules");
		await expect(
			git.readTree({ fs, gitdir: shipped, oid: nm?.oid as string }),
		).rejects.toThrow();
	});

	test("meta.json summarises branches (current first) and tags", () => {
		expect(meta.head.branch).toBe("main");
		expect(meta.branches.map((b) => [b.name, b.current, b.commits])).toEqual([
			["main", true, 4],
			["feature/lanterns", false, 5],
		]);
		expect(meta.branches[1]).toMatchObject({
			subject: "Hang lanterns",
			author: "Wren Hollow",
		});
		expect(meta.tags.find((t) => t.name === "v0.2.0")).toMatchObject({
			annotated: true,
		});
		expect(meta.pack.halvings).toBe(0);
	});

	test.skipIf(!systemGit())(
		"real git accepts the pack and walks the history",
		() => {
			const idx = parseGitFiles(
				JSON.parse(bundle.get("git/files.json") as string),
			)?.files.find((f) => f.endsWith(".idx")) as string;
			execFileSync("git", ["verify-pack", join(shipped, idx)], {
				stdio: "pipe",
			});
			// Real git only recognises a git dir that has refs/; files.json can't carry an empty folder, and isomorphic-git doesn't need one.
			fs.mkdirSync(join(shipped, "refs"), { recursive: true });
			const out = execFileSync(
				"git",
				["--git-dir", shipped, "log", "--format=%s", "main"],
				{
					encoding: "utf8",
				},
			);
			expect(out.trim().split("\n")).toHaveLength(4);
		},
	);

	test("a branch converts as a universe from the shipped objects, with unshipped blobs sealed", async () => {
		const head = await git.resolveRef({
			fs,
			gitdir: shipped,
			ref: "refs/heads/feature/lanterns",
		});
		const { commit } = await git.readCommit({ fs, gitdir: shipped, oid: head });
		const opened: OpenedRepo = {
			fs,
			root: shipped,
			gitdir: shipped,
			prefix: "",
			cache: {},
		};
		const source = new GitTreeSource(opened, commit.tree, {
			ignore: [],
			omittedSizes: meta.omitted,
		});
		const world = await convert(source, {
			name: "garden",
			source: `${repo.dir}#feature/lanterns`,
			now: NOW,
			sealedPaths: source.sealedPaths,
		});
		const manifest = JSON.parse(
			world.get("world.json") as string,
		) as WorldManifest;
		const ids = manifest.portals.map((p) => p.id);
		expect(ids).toContain("lanterns.md");
		expect(ids).toContain("deploy.pem");
		expect(
			manifest.portals.find((p) => p.id === "deploy.pem")?.richPreview,
		).toEqual({
			kind: "sealed",
		});
		// Withheld, not an empty file: SourceEntry.read's undefined.
		for await (const entry of source.entries())
			if (entry.path === "deploy.pem")
				expect(await entry.read()).toBeUndefined();
		// Its blob was withheld from the pack for the key in its text, so here it is sealed too.
		expect(
			manifest.portals.find((p) => p.id === "src/secret.js")?.richPreview,
		).toEqual({ kind: "sealed" });
		expect(
			manifest.portals.find((p) => p.id === "lanterns.md")?.richPreview?.kind,
		).not.toBe("sealed");
	});
});

describe("caps and options", () => {
	const repos: FixtureRepo[] = [];
	afterEach(async () => {
		for (const r of repos.splice(0)) await r.cleanup();
	});
	async function standard() {
		const r = await createStandardFixture();
		repos.push(r);
		return r;
	}
	const config = (repo: FixtureRepo, history: object) =>
		writeFile(
			join(repo.dir, "cabn.json"),
			JSON.stringify({ cabnConfigVersion: 1, history }),
		);

	test("maxCommitsPerBranch sets a shallow boundary git itself respects", async () => {
		const repo = await standard();
		// No tags: they would pull older commits back in and close the gap.
		await config(repo, { maxCommitsPerBranch: 2, maxTags: 0 });
		const bundle = await convertRepo(repo);
		expect(bundle.has("git/shallow")).toBe(true);
		const shipped = await materialize(bundle);
		try {
			expect(await git.log({ fs, gitdir: shipped, ref: "main" })).toHaveLength(
				2,
			);
			expect(metaOf(bundle).branches[0]).toMatchObject({
				commits: 2,
				truncated: true,
			});
		} finally {
			await rm(shipped, { recursive: true, force: true });
		}
	});

	test("each widened secret name is left out of every commit; ordinary files beside them ship", async () => {
		const repo = await createFixtureRepo();
		repos.push(repo);
		const secrets = {
			".pypirc": "[pypi]\npassword = pypi-hunter2\n",
			".yarnrc.yml": "npmAuthToken: yarn-hunter2\n",
			".envrc": "export TOKEN=direnv-hunter2\n",
			".terraformrc":
				'credentials "app.terraform.io" { token = "tf-hunter2" }\n',
			".docker/config.json": '{"auths":{"x":{"auth":"docker-hunter2"}}}\n',
			".kube/config": "users:\n- user:\n    token: kube-hunter2\n",
			"ops/.kube/config": "users:\n- user:\n    token: kube2-hunter2\n",
		};
		await repo.commit(
			{
				...secrets,
				"docker/config.json": '{"plain": true}\n',
				"README.md": "# Plain\n",
			},
			"Configs",
			0,
		);
		const bundle = await convertRepo(repo);
		const meta = metaOf(bundle);
		const shipped = await materialize(bundle);
		try {
			const [head] = await git.log({ fs, gitdir: shipped, ref: "main" });
			const oidAt = async (filepath: string) =>
				(
					await git.readBlob({
						fs,
						dir: repo.dir,
						oid: head?.oid as string,
						filepath,
					})
				).oid;
			for (const path of Object.keys(secrets)) {
				const oid = await oidAt(path);
				expect(meta.omitted[oid], path).toMatchObject({
					reason: "secret-name",
				});
				await expect(
					git.readBlob({ fs, gitdir: shipped, oid }),
					path,
				).rejects.toThrow();
			}
			for (const path of ["docker/config.json", "README.md"]) {
				const { blob } = await git.readBlob({
					fs,
					gitdir: shipped,
					oid: head?.oid as string,
					filepath: path,
				});
				expect(blob.length, path).toBeGreaterThan(0);
			}
			const pack = [...bundle.entries()].find(([k]) => k.endsWith(".pack"));
			expect(decoder.decode(pack?.[1] as Uint8Array)).not.toContain("hunter2");
		} finally {
			await rm(shipped, { recursive: true, force: true });
		}
	});

	test("a tracked config.ts with a planted key is left out of the pack; clean code ships", async () => {
		const repo = await createFixtureRepo();
		repos.push(repo);
		await repo.commit(
			{
				"src/config.ts": `export const anthropic = "${FAKE_ANTHROPIC_KEY}";\n`,
				"src/app.ts": "export const answer = 42;\n",
			},
			"Configure",
			0,
		);
		const bundle = await convertRepo(repo);
		const meta = metaOf(bundle);
		const shipped = await materialize(bundle);
		try {
			const [head] = await git.log({ fs, gitdir: shipped, ref: "main" });
			const leaky = (
				await git.readBlob({
					fs,
					dir: repo.dir,
					oid: head?.oid as string,
					filepath: "src/config.ts",
				})
			).oid;
			expect(meta.omitted[leaky]).toMatchObject({ reason: "secret-name" });
			await expect(
				git.readBlob({ fs, gitdir: shipped, oid: leaky }),
			).rejects.toThrow();
			const { blob } = await git.readBlob({
				fs,
				gitdir: shipped,
				oid: head?.oid as string,
				filepath: "src/app.ts",
			});
			expect(decoder.decode(blob)).toBe("export const answer = 42;\n");
			for (const [key, value] of bundle)
				if (typeof value !== "string" || key.startsWith("git/"))
					expect(Buffer.from(value).includes(FAKE_ANTHROPIC_KEY), key).toBe(
						false,
					);
		} finally {
			await rm(shipped, { recursive: true, force: true });
		}
	});

	test("maxBlobBytes leaves big blobs out as too-large", async () => {
		const repo = await standard();
		await repo.commit(
			{ "big.bin": randomBytes(40 * 1024).toString("hex") },
			"Big",
			6,
		);
		await config(repo, { maxBlobBytes: 16 * 1024 });
		const meta = metaOf(await convertRepo(repo));
		expect(
			Object.values(meta.omitted).some(
				(o) => o.reason === "too-large" && o.size === 80 * 1024,
			),
		).toBe(true);
	});

	test("the boundary halves until the pack fits maxPackBytes, and says so", async () => {
		const repo = await createFixtureRepo();
		repos.push(repo);
		for (let n = 0; n < 8; n++)
			await repo.commit(
				{ "noise.txt": randomBytes(300 * 1024).toString("base64") },
				`rev ${n}`,
				n,
			);
		await config(repo, { maxPackBytes: 1024 * 1024 });
		const bundle = await convertRepo(repo);
		const meta = metaOf(bundle);
		expect(meta.pack.halvings).toBeGreaterThan(0);
		expect(meta.pack.commitsPerBranch).toBeLessThan(200);
		expect(meta.pack.bytes).toBeLessThanOrEqual(1024 * 1024);
	});

	test("history.enabled=false and a non-root directory get no git/", async () => {
		const repo = await standard();
		const sub = await convert(new DirSource(join(repo.dir, "src")), {
			name: "src",
			source: "src",
			git: { fs, dir: join(repo.dir, "src") },
		});
		expect(sub.has("git/files.json")).toBe(false);
		await config(repo, { enabled: false });
		expect((await convertRepo(repo)).has("git/files.json")).toBe(false);
	});

	test("releases.json: none without a github remote, offline without a fetch, filled with one", async () => {
		const repo = await standard();
		const releasesOf = (b: WorldBundle) =>
			parseReleasesFile(JSON.parse(b.get("releases.json") as string));
		expect(releasesOf(await convertRepo(repo))?.source).toBe("none");
		await git.addRemote({
			fs,
			dir: repo.dir,
			remote: "origin",
			url: "git@github.com:wren/garden.git",
		});
		expect(releasesOf(await convertRepo(repo))?.source).toBe("offline");
		const fetch: GithubFetch = async () => ({
			ok: true,
			status: 200,
			json: async () => [
				{
					tag_name: "v0.2.0",
					name: "Second harvest",
					body: "notes",
					html_url: "https://github.com/wren/garden/releases/tag/v0.2.0",
					assets: [],
				},
				{ tag_name: "evil", html_url: "https://evil.example/", assets: [] },
			],
		});
		const r = releasesOf(
			await convertRepo(repo, {
				git: { fs, dir: repo.dir, github: { fetch } },
			}),
		);
		expect(r?.source).toBe("github");
		expect(r?.items.map((i) => i.tagName)).toEqual(["v0.2.0"]);
	});

	test("an unreadable .git pointer warns and skips history", async () => {
		const other = await createFixtureRepo();
		repos.push(other);
		await fs.promises.rm(join(other.dir, ".git"), { recursive: true });
		await writeFile(
			join(other.dir, ".git"),
			"gitdir: /nonexistent/worktrees/x\n",
		);
		await writeFile(join(other.dir, "b.txt"), "b\n");
		const warnings: string[] = [];
		const bundle = await convert(new DirSource(other.dir), {
			name: "b",
			source: other.dir,
			git: { fs, dir: other.dir },
			onWarning: (m) => warnings.push(m),
		});
		expect(bundle.has("git/files.json")).toBe(false);
		expect(warnings.join("\n")).toMatch(/git history skipped/);
	});
});

describe("history comes only from a real <root>/.git directory", () => {
	const cleanups: (() => Promise<void>)[] = [];
	afterEach(async () => {
		for (const c of cleanups.splice(0)) await c();
	});

	async function elsewhereRepo(): Promise<FixtureRepo> {
		const repo = await createFixtureRepo();
		cleanups.push(repo.cleanup);
		await repo.commit({ "far.md": "# Far away\n" }, "Far commit", 0);
		return repo;
	}

	async function plainFolder(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "cabn-git-root-"));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		await writeFile(join(dir, "near.md"), "# Near\n");
		return dir;
	}

	async function convertWithWarnings(
		dir: string,
		gitdir?: string,
	): Promise<{ bundle: WorldBundle; warnings: string[] }> {
		const warnings: string[] = [];
		const bundle = await convert(new DirSource(dir), {
			name: "near",
			source: dir,
			git: { fs, dir, ...(gitdir ? { gitdir } : {}) },
			onWarning: (m) => warnings.push(m),
		});
		return { bundle, warnings };
	}

	test("a gitdir: pointer file to a real repository elsewhere ships no history and names no path", async () => {
		const far = await elsewhereRepo();
		const dir = await plainFolder();
		await writeFile(join(dir, ".git"), `gitdir: ${join(far.dir, ".git")}\n`);
		const { bundle, warnings } = await convertWithWarnings(dir);
		expect(bundle.has("git/files.json")).toBe(false);
		const text = warnings.join("\n");
		expect(text).toMatch(/git history skipped: .*pointer file.*--git-dir/);
		expect(text).not.toContain(far.dir);
		expect(text).not.toContain(dir);
		expect(text).not.toContain(tmpdir());
	});

	test("a .git symlink to a repository elsewhere ships no history and names no path", async () => {
		const far = await elsewhereRepo();
		const dir = await plainFolder();
		await fs.promises.symlink(join(far.dir, ".git"), join(dir, ".git"));
		const { bundle, warnings } = await convertWithWarnings(dir);
		expect(bundle.has("git/files.json")).toBe(false);
		const text = warnings.join("\n");
		expect(text).toMatch(/git history skipped: .*symlink.*--git-dir/);
		expect(text).not.toContain(far.dir);
		expect(text).not.toContain(tmpdir());
	});

	test("a real .git directory ships history", async () => {
		const repo = await elsewhereRepo();
		const { bundle, warnings } = await convertWithWarnings(repo.dir);
		expect(bundle.has("git/files.json")).toBe(true);
		expect(metaOf(bundle).branches.map((b) => b.subject)).toEqual([
			"Far commit",
		]);
		expect(warnings).toEqual([]);
	});

	test("an explicit --git-dir still reads a repository outside the folder", async () => {
		const far = await elsewhereRepo();
		const dir = await plainFolder();
		await writeFile(join(dir, ".git"), `gitdir: ${join(far.dir, ".git")}\n`);
		const { bundle } = await convertWithWarnings(dir, join(far.dir, ".git"));
		expect(bundle.has("git/files.json")).toBe(true);
		expect(metaOf(bundle).branches.map((b) => b.subject)).toEqual([
			"Far commit",
		]);
	});
});
