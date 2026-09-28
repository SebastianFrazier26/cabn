import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseSeyn,
	parseSignIndex,
	type SignIndexFile,
	SignIndexFileSchema,
	type WorldManifest,
} from "@cabn/world-schema";
import MiniSearch from "minisearch";
import { afterEach, describe, expect, test } from "vitest";
import { convert } from "../src/convert.js";
import { SEARCH_FIELDS, SEARCH_STORE_FIELDS } from "../src/search-index.js";
import {
	buildSignEntry,
	resolveSignAnchor,
	type SignWorldIndex,
} from "../src/signs.js";
import { DirSource } from "../src/sources/dir.js";

const world: SignWorldIndex = {
	portalIds: new Set(["src/index.ts", "README.md"]),
	clusters: [
		{ id: "root", path: "." },
		{ id: "src", path: "src" },
		{ id: "src__2", path: "src", annexOf: "src" },
		{ id: "docs", path: "docs" },
	],
};

describe("resolveSignAnchor", () => {
	const anchor = (path: string, text: string) =>
		resolveSignAnchor(path, parseSeyn(text, { path }), world);

	test("@near a file with a portal", () => {
		expect(anchor("src/a.seyn", "@near index.ts")).toEqual({
			kind: "portal",
			id: "src/index.ts",
		});
	});

	test("@near a folder picks the original cluster, not an annex", () => {
		expect(anchor("x.seyn", "@near /src/")).toEqual({
			kind: "cluster",
			id: "src",
		});
		expect(anchor("x.seyn", "@near /")).toEqual({
			kind: "cluster",
			id: "root",
		});
	});

	test("missing or invalid @near falls back to the nearest folder with a cluster", () => {
		expect(anchor("docs/deep/er/x.seyn", "")).toEqual({
			kind: "cluster",
			id: "docs",
		});
		expect(anchor("src/x.seyn", "@near gone.ts")).toEqual({
			kind: "cluster",
			id: "src",
		});
		expect(anchor("nowhere/x.seyn", "@near ../../../etc/passwd")).toEqual({
			kind: "cluster",
			id: "root",
		});
	});

	test("null only without clusters", () => {
		expect(
			resolveSignAnchor("a.seyn", parseSeyn(""), {
				portalIds: new Set(),
				clusters: [],
			}),
		).toBeNull();
	});
});

describe("buildSignEntry", () => {
	test("decodes bytes and keeps the raw source", () => {
		const built = buildSignEntry(
			"src/a.seyn",
			new TextEncoder().encode("@near index.ts\n# Hi\n"),
			world,
		);
		expect(built?.entry).toEqual({
			path: "src/a.seyn",
			source: "@near index.ts\n# Hi\n",
			anchor: { kind: "portal", id: "src/index.ts" },
		});
		expect(built?.doc.title).toBe("Hi");
	});

	test("oversized sources are cut to the cap", () => {
		const built = buildSignEntry("a.seyn", "x".repeat(40_000), world);
		expect(built?.entry.source.length).toBe(16 * 1024);
		expect(
			SignIndexFileSchema.safeParse({
				signsVersion: 1,
				signs: [built?.entry],
			}).success,
		).toBe(true);
	});
});

describe("convert: .seyn files", () => {
	let dir: string | undefined;
	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
		dir = undefined;
	});

	test("become signs.json entries and search docs, never portals", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-signs-"));
		await mkdir(join(dir, "src"));
		await mkdir(join(dir, "notes"));
		await writeFile(join(dir, "README.md"), "# readme\n");
		await writeFile(join(dir, "src", "index.ts"), "export const x = 1;\n");
		await writeFile(
			join(dir, "src", "index.seyn"),
			"@near index.ts\n# Entry point\n\nThe *bramblewood* starts here.\n",
		);
		await writeFile(join(dir, "welcome.seyn"), "Hello, traveller.\n");
		// A folder holding only a sign has no cluster of its own.
		await writeFile(join(dir, "notes", "lonely.seyn"), "alone\n");

		const bundle = await convert(new DirSource(dir), {
			name: "signs",
			source: dir,
		});
		const manifest = JSON.parse(
			bundle.get("world.json") as string,
		) as WorldManifest;
		expect(manifest.portals.map((p) => p.id).sort()).toEqual([
			"README.md",
			"src/index.ts",
		]);
		expect(manifest.meta.fileCount).toBe(2);

		const raw = JSON.parse(bundle.get("signs.json") as string) as SignIndexFile;
		expect(SignIndexFileSchema.safeParse(raw).success).toBe(true);
		const signs = parseSignIndex(raw);
		const rootId = manifest.clusters.find((c) => c.path === ".")?.id;
		expect(signs.map((s) => [s.path, s.anchor])).toEqual([
			["notes/lonely.seyn", { kind: "cluster", id: rootId }],
			["src/index.seyn", { kind: "portal", id: "src/index.ts" }],
			["welcome.seyn", { kind: "cluster", id: rootId }],
		]);

		const search = JSON.parse(bundle.get("search-index.json") as string);
		const mini = MiniSearch.loadJSON(JSON.stringify(search.index), {
			fields: [...SEARCH_FIELDS],
			storeFields: [...SEARCH_STORE_FIELDS],
		});
		const hits = mini.search("bramblewood");
		expect(hits.map((h) => h.id)).toEqual(["src/index.seyn"]);
		expect(hits[0]?.name).toBe("Entry point");
	});

	test("a world without signs still writes an empty signs.json", async () => {
		dir = await mkdtemp(join(tmpdir(), "cabn-signs-"));
		await writeFile(join(dir, "a.txt"), "a\n");
		const bundle = await convert(new DirSource(dir), {
			name: "x",
			source: dir,
		});
		expect(JSON.parse(bundle.get("signs.json") as string)).toEqual({
			signsVersion: 1,
			signs: [],
		});
	});
});
