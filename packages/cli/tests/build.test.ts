import { mkdtemp, readFile, rm } from "node:fs/promises";
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
