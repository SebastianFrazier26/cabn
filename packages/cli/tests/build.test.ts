import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runBuild } from "../src/build.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
let outDir: string;

beforeEach(async () => {
	outDir = join(await mkdtemp(join(tmpdir(), "cabn-cli-build-")), "world");
});

afterEach(async () => {
	await rm(outDir, { recursive: true, force: true });
});

test("writes a bundle with the expected files and a matching summary", async () => {
	const summary = await runBuild(FIXTURE, { outDir });

	expect(summary.outDir).toBe(outDir);
	expect(summary.portals).toBe(2); // README.md + main.py
	expect(summary.clusters).toBe(1); // both files are at the root
	expect(summary.bytes).toBeGreaterThan(0);

	const manifest = JSON.parse(
		await readFile(join(outDir, "world.json"), "utf8"),
	);
	expect(manifest.cabnVersion).toBe(1);
	expect(await readFile(join(outDir, "assets.json"), "utf8")).toContain(
		"atlases",
	);
	expect(await readFile(join(outDir, "search-index.json"), "utf8")).toContain(
		"minisearch",
	);
});

test("defaults outDir to ./<name>-world when not given", async () => {
	const summary = await runBuild(FIXTURE);
	try {
		expect(summary.outDir.endsWith("tiny-project-world")).toBe(true);
	} finally {
		await rm(summary.outDir, { recursive: true, force: true });
	}
});

test("--findings: turns an ESLint JSON results file into monsters and reports the tally", async () => {
	const dir = await mkdtemp(join(tmpdir(), "cabn-cli-findings-"));
	try {
		const findingsPath = join(dir, "eslint.json");
		await writeFile(
			findingsPath,
			JSON.stringify([
				{
					filePath: join(FIXTURE, "main.py"),
					messages: [
						{
							ruleId: "custom/odd",
							severity: 2,
							message: "odd",
							line: 2,
							column: 5,
						},
					],
				},
				{
					filePath: "/nowhere/else.py",
					messages: [{ ruleId: "x", severity: 1, message: "?", line: 1 }],
				},
			]),
		);
		const summary = await runBuild(FIXTURE, {
			outDir,
			findingsPaths: [findingsPath],
		});
		expect(summary.findings).toEqual({ ingested: 2, attached: 1, dropped: 1 });
		expect(summary.monsters).toBe(1);
		const index = JSON.parse(
			await readFile(join(outDir, "monsters.json"), "utf8"),
		);
		expect(index.monsters[0]).toMatchObject({
			portalId: "main.py",
			species: "shade",
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("--findings: rejects a file that isn't JSON or isn't ESLint/SARIF, naming the file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "cabn-cli-findings-"));
	try {
		const notJson = join(dir, "broken.json");
		await writeFile(notJson, "{ nope");
		await expect(
			runBuild(FIXTURE, { outDir, findingsPaths: [notJson] }),
		).rejects.toThrow(/broken\.json is not valid JSON/);
		const wrongShape = join(dir, "wrong.json");
		await writeFile(wrongShape, JSON.stringify({ results: [] }));
		await expect(
			runBuild(FIXTURE, { outDir, findingsPaths: [wrongShape] }),
		).rejects.toThrow(/wrong\.json: Invalid findings file/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
