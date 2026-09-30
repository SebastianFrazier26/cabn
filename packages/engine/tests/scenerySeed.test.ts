import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { convert, DirSource } from "@cabn/converter";
import { validateManifest, type WorldManifest } from "@cabn/world-schema";
import { afterAll, describe, expect, it } from "vitest";
import {
	type Footprint,
	planLayeredEdgeScenery,
	type SceneryKind,
} from "../src/systems/edgeScenery.js";
import { computeScenerySeed, computeWorldId } from "../src/systems/save.js";
import { planGrownSkyline, planSkyline } from "../src/systems/skylineLayout.js";

const FOOTPRINTS: Record<SceneryKind, Footprint> = {
	pine: { w: 84, h: 144 },
	oak: { w: 120, h: 156 },
	"blossom-oak": { w: 120, h: 156 },
	shrub: { w: 78, h: 60 },
	"berry-shrub": { w: 78, h: 60 },
	boulder: { w: 90, h: 66 },
	"rock-small": { w: 54, h: 36 },
	"flower-patch": { w: 84, h: 54 },
	stump: { w: 60, h: 48 },
	reeds: { w: 54, h: 66 },
	pond: { w: 240, h: 144 },
	windmill: { w: 108, h: 180 },
	ruin: { w: 180, h: 144 },
	mushroom: { w: 24, h: 24 },
	"fallen-log": { w: 144, h: 48 },
	waymarker: { w: 72, h: 108 },
};

const TREE: Record<string, string> = {
	"README.md": "# garden\n",
	"src/index.ts": "export const x = 1;\n",
	"src/util/strings.ts": "export const s = 'a';\n",
	"docs/guide.md": "hello\n",
	"config/settings.json": '{ "a": 1 }\n',
};

const tempRoots: string[] = [];

afterAll(async () => {
	for (const dir of tempRoots) await rm(dir, { recursive: true, force: true });
});

/** Writes `files` under a fresh temp root as `<root>/garden` and converts it the way `cabn serve` does (name = folder basename, source = absolute path). */
async function convertTree(
	files: Record<string, string>,
	now: Date,
): Promise<WorldManifest> {
	const root = await mkdtemp(join(tmpdir(), "cabn-scenery-seed-"));
	tempRoots.push(root);
	const dir = join(root, "garden");
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	const bundle = await convert(new DirSource(dir), {
		name: "garden",
		source: dir,
		now: () => now,
	});
	return validateManifest(JSON.parse(bundle.get("world.json") as string));
}

function plans(manifest: WorldManifest) {
	const seed = computeScenerySeed(manifest);
	const xs = manifest.clusters.map((c) => c.pos.x);
	const ys = manifest.clusters.map((c) => c.pos.y);
	const bounds = {
		minX: Math.min(...xs) - 900,
		minY: Math.min(...ys) - 900,
		maxX: Math.max(...xs) + 900,
		maxY: Math.max(...ys) + 900,
	};
	const base = {
		bounds,
		seed,
		circles: manifest.clusters.map((c) => ({
			x: c.pos.x,
			y: c.pos.y,
			radius: 200,
		})),
		segments: [],
		footprints: FOOTPRINTS,
		windmillSailSpan: 186,
	};
	const grownBounds = {
		minX: bounds.minX - 600,
		minY: bounds.minY,
		maxX: bounds.maxX + 600,
		maxY: bounds.maxY,
	};
	const skylineInput = {
		seed,
		scrollMin: bounds.minX,
		scrollMax: bounds.maxX,
		viewWidth: 1280,
		widths: {
			castle: 384,
			watchtower: 56,
			village: 160,
			hill: 192,
			treeline: 120,
		},
	};
	return {
		seed,
		scenery: planLayeredEdgeScenery(base, null),
		layeredScenery: planLayeredEdgeScenery(base, {
			bounds: grownBounds,
			circles: [],
			segments: [],
		}),
		skyline: planSkyline(skylineInput),
		grownSkyline: planGrownSkyline(skylineInput, {
			scrollMin: grownBounds.minX,
			scrollMax: grownBounds.maxX,
		}),
	};
}

describe("computeScenerySeed", () => {
	it("gives the same scenery and skyline for the same tree converted at different times from different temp folders", async () => {
		const a = await convertTree(TREE, new Date("2026-09-29T10:00:00.000Z"));
		const b = await convertTree(TREE, new Date("2026-09-30T18:30:00.000Z"));
		expect(a.meta.source).not.toBe(b.meta.source);
		expect(a.meta.generatedAt).not.toBe(b.meta.generatedAt);
		// Saves stay keyed per conversion.
		expect(computeWorldId(a.meta)).not.toBe(computeWorldId(b.meta));
		const pa = plans(a);
		const pb = plans(b);
		expect(pa.seed).toBe(pb.seed);
		expect(pa.scenery.items.length).toBeGreaterThan(0);
		expect(pa).toEqual(pb);
	});

	it("changes when a file is added or removed", async () => {
		const now = new Date("2026-09-29T10:00:00.000Z");
		const base = computeScenerySeed(await convertTree(TREE, now));
		const added = computeScenerySeed(
			await convertTree({ ...TREE, "src/extra.ts": "export {};\n" }, now),
		);
		const { "docs/guide.md": _removed, ...fewer } = TREE;
		const removed = computeScenerySeed(await convertTree(fewer, now));
		expect(added).not.toBe(base);
		expect(removed).not.toBe(base);
	});

	it("ignores file order and depends on the project name", () => {
		const manifest = {
			meta: { name: "garden" },
			clusters: [{ path: "" }, { path: "src" }],
			portals: [{ file: { path: "a.ts" } }, { file: { path: "src/b.ts" } }],
		};
		const shuffled = {
			...manifest,
			clusters: [...manifest.clusters].reverse(),
			portals: [...manifest.portals].reverse(),
		};
		expect(computeScenerySeed(shuffled)).toBe(computeScenerySeed(manifest));
		expect(
			computeScenerySeed({ ...manifest, meta: { name: "orchard" } }),
		).not.toBe(computeScenerySeed(manifest));
	});

	it("works for an older manifest without themeSeed", async () => {
		const manifest = await convertTree(
			TREE,
			new Date("2026-09-29T10:00:00.000Z"),
		);
		const { themeSeed: _dropped, ...oldMeta } = manifest.meta;
		const old = validateManifest({ ...manifest, meta: oldMeta });
		expect(computeScenerySeed(old)).toBe(computeScenerySeed(manifest));
	});
});
