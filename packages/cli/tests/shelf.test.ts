import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runBuild } from "../src/build.js";
import { runShelf } from "../src/shelf.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "tiny-project");
let root: string;
let bundleA: string;
let bundleB: string;
let outDir: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "cabn-cli-shelf-"));
	bundleA = join(root, "a-world");
	bundleB = join(root, "b-world");
	outDir = join(root, "shelf-out");
	await runBuild(FIXTURE, { outDir: bundleA });
	await runBuild(FIXTURE, { outDir: bundleB });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test("writes a shelf.json listing every bundle with relative worldUrls", async () => {
	const summary = await runShelf([bundleA, bundleB], { outDir });
	expect(summary.outDir).toBe(outDir);
	expect(summary.worlds).toBe(2);

	const shelf = JSON.parse(await readFile(join(outDir, "shelf.json"), "utf8"));
	expect(shelf.cabnVersion).toBe(1);
	expect(shelf.worlds).toHaveLength(2);
	// outDir (shelf-out/) is a sibling of both bundle dirs, not their parent,
	// so the relative path legitimately climbs out one level.
	expect(shelf.worlds.map((w: { worldUrl: string }) => w.worldUrl)).toEqual([
		"../a-world/world.json",
		"../b-world/world.json",
	]);
	// Both bundles come from the same fixture, converted to different
	// outDirs, so meta.source (and therefore themeSeed) legitimately differs.
	expect(shelf.worlds[0].id).not.toBe(shelf.worlds[1].id);
});

test("dedupes world ids when two bundles share a display name", async () => {
	const shelf = JSON.parse(
		await readFile(
			join(
				(await runShelf([bundleA, bundleB], { outDir })).outDir,
				"shelf.json",
			),
			"utf8",
		),
	);
	// tiny-project's world.json meta.name is the same ("tiny-project") for
	// both bundles, so the slug collision has to resolve via buildShelf's
	// numeric-suffix rule instead of silently overwriting one entry.
	expect(shelf.worlds.map((w: { id: string }) => w.id)).toEqual([
		"tiny-project",
		"tiny-project-2",
	]);
});
