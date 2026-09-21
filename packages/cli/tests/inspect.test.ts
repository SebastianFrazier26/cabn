import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runBuild } from "../src/build.js";
import { formatSummary, runInspect } from "../src/inspect.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
let outDir: string;

beforeEach(async () => {
	outDir = join(await mkdtemp(join(tmpdir(), "cabn-cli-inspect-")), "world");
	await runBuild(FIXTURE, { outDir });
});

afterEach(async () => {
	await rm(outDir, { recursive: true, force: true });
});

test("runInspect validates and returns the manifest", async () => {
	const manifest = await runInspect(outDir);
	expect(manifest.meta.name).toBe("tiny-project");
	expect(manifest.portals).toHaveLength(2);
});

test("formatSummary reports clusters, portals, and biome", async () => {
	const manifest = await runInspect(outDir);
	const text = formatSummary(manifest);
	expect(text).toContain("tiny-project");
	expect(text).toContain("meadow");
	expect(text).toContain("2 portals");
});

test("runInspect rejects a bundle with no world.json", async () => {
	await expect(runInspect(join(outDir, "does-not-exist"))).rejects.toThrow();
});
