import type { WorldManifest } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { buildShelf } from "../src/shelf.js";

const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

function fakeManifest(
	overrides: Partial<WorldManifest["meta"]> = {},
): WorldManifest {
	return {
		cabnVersion: 1,
		meta: {
			name: "sample",
			source: "/tmp/sample",
			generatedAt: FIXED_NOW().toISOString(),
			fileCount: 15,
			totalBytes: 4096,
			truncated: false,
			skippedFiles: 0,
			themeSeed: 12345,
			...overrides,
		},
		clusters: [],
		paths: [],
		portals: [],
		monsters: [],
	};
}

describe("buildShelf", () => {
	test("produces a validated shelf manifest from world inputs", () => {
		const shelf = buildShelf(
			[
				{
					name: "sample",
					worldUrl: "sample/world.json",
					manifest: fakeManifest(),
				},
			],
			{ now: FIXED_NOW },
		);
		expect(shelf.cabnVersion).toBe(1);
		expect(shelf.meta.generatedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(shelf.worlds).toEqual([
			{
				id: "sample",
				name: "sample",
				worldUrl: "sample/world.json",
				themeSeed: 12345,
				fileCount: 15,
				totalBytes: 4096,
			},
		]);
	});

	test("defaults meta.name to 'My Worlds'", () => {
		const shelf = buildShelf(
			[{ name: "a", worldUrl: "a/world.json", manifest: fakeManifest() }],
			{ now: FIXED_NOW },
		);
		expect(shelf.meta.name).toBe("My Worlds");
	});

	test("slugifies names into ids and dedupes collisions", () => {
		const shelf = buildShelf(
			[
				{
					name: "My World",
					worldUrl: "a/world.json",
					manifest: fakeManifest(),
				},
				{
					name: "my world!!",
					worldUrl: "b/world.json",
					manifest: fakeManifest(),
				},
			],
			{ now: FIXED_NOW },
		);
		expect(shelf.worlds.map((w) => w.id)).toEqual(["my-world", "my-world-2"]);
	});

	test("falls back to themeSeed 0 when a manifest predates the field", () => {
		const manifest = fakeManifest();
		delete (manifest.meta as { themeSeed?: number }).themeSeed;
		const shelf = buildShelf(
			[{ name: "old", worldUrl: "old/world.json", manifest }],
			{ now: FIXED_NOW },
		);
		expect(shelf.worlds[0]?.themeSeed).toBe(0);
	});

	test("produces an empty-but-valid shelf for no worlds", () => {
		const shelf = buildShelf([], { now: FIXED_NOW });
		expect(shelf.worlds).toEqual([]);
	});
});
