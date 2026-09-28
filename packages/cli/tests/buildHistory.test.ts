import * as fs from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliGithubNetwork, runBuild } from "../src/build.js";

let repoDir: string;
let outDir: string;
const FAKE_TOKEN = ["ghp", "_", "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jh1Gf0EdCbA"].join("");

beforeEach(async () => {
	repoDir = await mkdtemp(join(tmpdir(), "cabn-cli-history-"));
	outDir = join(
		await mkdtemp(join(tmpdir(), "cabn-cli-history-out-")),
		"world",
	);
	await git.init({ fs, dir: repoDir, defaultBranch: "main" });
	await writeFile(join(repoDir, "README.md"), "# Garden\n");
	await git.add({ fs, dir: repoDir, filepath: "README.md" });
	await git.commit({
		fs,
		dir: repoDir,
		message: "Plant",
		author: {
			name: "Wren",
			email: "wren@hollow.example",
			timestamp: 1780000000,
			timezoneOffset: 0,
		},
	});
	await git.addRemote({
		fs,
		dir: repoDir,
		remote: "origin",
		url: "https://github.com/wren/garden.git",
	});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(repoDir, { recursive: true, force: true });
	await rm(outDir, { recursive: true, force: true });
});

async function allOutput(dir: string): Promise<string> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	const texts = await Promise.all(
		entries
			.filter((e) => e.isFile())
			.map((e) => readFile(join(e.parentPath, e.name), "utf8")),
	);
	return texts.join("\n");
}

describe("cabn build of a git repository", () => {
	it("writes history.json and reports it; --offline records releases as offline", async () => {
		const summary = await runBuild(repoDir, { outDir, offline: true });
		expect(summary.history).toMatchObject({
			commits: 1,
			branches: 1,
			releases: "offline",
		});
		const history = JSON.parse(
			await readFile(join(outDir, "history.json"), "utf8"),
		);
		expect(history.head.branch).toBe("main");
	});

	it("--no-history writes none", async () => {
		const summary = await runBuild(repoDir, {
			outDir,
			offline: true,
			history: false,
		});
		expect(summary.history).toBeUndefined();
		expect(fs.existsSync(join(outDir, "history.json"))).toBe(false);
	});

	it("sends GITHUB_TOKEN to api.github.com only in a header, never into the bundle", async () => {
		vi.stubEnv("GITHUB_TOKEN", FAKE_TOKEN);
		const seen: { url: string; auth: string | undefined }[] = [];
		vi.stubGlobal(
			"fetch",
			async (url: string, init: { headers: Record<string, string> }) => {
				seen.push({ url, auth: init.headers.authorization });
				const body = url.includes("/releases")
					? [
							{
								tag_name: "v1",
								name: "One",
								body: "First harvest",
								html_url: "https://github.com/wren/garden/releases/tag/v1",
								assets: [],
							},
						]
					: [];
				return new Response(JSON.stringify(body), { status: 200 });
			},
		);
		// Only the embed check would use fetch too; this world has no url previews.
		const summary = await runBuild(repoDir, { outDir });
		expect(summary.history?.releases).toBe("github");
		expect(seen[0]?.url).toBe(
			"https://api.github.com/repos/wren/garden/releases?per_page=10",
		);
		expect(seen.every((s) => s.auth === `Bearer ${FAKE_TOKEN}`)).toBe(true);
		const output = await allOutput(outDir);
		expect(output).toContain("First harvest");
		expect(output).not.toContain(FAKE_TOKEN);
		expect(output).not.toContain("Bearer");
	});

	it("without a token the request is anonymous and packages are skipped", async () => {
		vi.stubEnv("GITHUB_TOKEN", "");
		const net = cliGithubNetwork(false);
		expect(net?.authenticated).toBe(false);
		expect(cliGithubNetwork(true)).toBeUndefined();
	});
});
