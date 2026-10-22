import type { Showcase, WorldManifest } from "@cabn/world-schema";
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

describe("buildShelf with showcase info", () => {
	const showcase = (extra: Partial<Showcase> = {}): Showcase => ({
		links: [],
		sitePortalIds: [],
		heroPortalId: null,
		...extra,
	});
	const world = (name: string, extra: Partial<Showcase> = {}) => ({
		name,
		worldUrl: `${name}/world.json`,
		manifest: fakeManifest({ name }),
		showcase: showcase(extra),
	});

	test("keeps input order when no world sets an order", () => {
		const shelf = buildShelf([world("zeta"), world("alpha")], {
			now: FIXED_NOW,
		});
		expect(shelf.worlds.map((w) => w.name)).toEqual(["zeta", "alpha"]);
	});

	test("sorts by order, then name, unordered worlds last", () => {
		const shelf = buildShelf(
			[
				world("delta"),
				world("charlie", { order: 2 }),
				world("bravo", { order: 1 }),
				world("alpha", { order: 2 }),
				world("echo"),
			],
			{ now: FIXED_NOW },
		);
		expect(shelf.worlds.map((w) => w.name)).toEqual([
			"bravo",
			"alpha",
			"charlie",
			"delta",
			"echo",
		]);
	});

	test("carries title, description, links, order and the hero url", () => {
		const manifest = fakeManifest({ name: "repo" });
		manifest.clusters = [
			{
				id: "root",
				path: ".",
				label: "root",
				pos: { x: 0, y: 0 },
				biome: "meadow",
				portalIds: ["@cabn-site/live"],
				chunk: "chunks/root.json",
			},
		];
		manifest.portals = [
			{
				id: "@cabn-site/live",
				clusterId: "root",
				file: {
					path: "@cabn-site/live",
					name: "Live",
					kind: "unknown",
					bytes: 0,
					binary: false,
				},
				preview: { lines: [], truncated: false },
				richPreview: { kind: "url", url: "https://demo.example.org/" },
				spawns: [],
			},
		];
		const shelf = buildShelf(
			[
				{
					name: "repo",
					worldUrl: "repo/world.json",
					manifest,
					showcase: showcase({
						title: "Pretty Title",
						description: "What it does.",
						links: [{ label: "Repo", url: "https://github.com/x/y" }],
						order: 1,
						sitePortalIds: ["@cabn-site/live"],
						heroPortalId: "@cabn-site/live",
					}),
				},
			],
			{ now: FIXED_NOW },
		);
		expect(shelf.worlds[0]).toMatchObject({
			id: "pretty-title",
			name: "Pretty Title",
			description: "What it does.",
			links: [{ label: "Repo", url: "https://github.com/x/y" }],
			heroUrl: "https://demo.example.org/",
			order: 1,
		});
	});

	test("an empty showcase adds no keys to the entry", () => {
		const shelf = buildShelf([world("plain")], { now: FIXED_NOW });
		expect(Object.keys(shelf.worlds[0] ?? {}).sort()).toEqual(
			["fileCount", "id", "name", "themeSeed", "totalBytes", "worldUrl"].sort(),
		);
	});
});
