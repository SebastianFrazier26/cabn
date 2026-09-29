import type { WorldLayerManifest, WorldManifest } from "@cabn/world-schema";
import { describe, expect, it } from "vitest";
import { layoutPortalRing } from "../src/systems/portalRing.js";
import {
	editorSaveTarget,
	isHiddenPath,
	LAYER_PATH_GATE_OUT_PX,
	layerPathRoutes,
	layerSaveSlotId,
	mergeLayer,
	ringPathsFor,
	signWriterFor,
	type WorldLayerProvider,
} from "../src/systems/worldLayer.js";
import { summarizeWorldMap } from "../src/systems/worldMap.js";

const GENERATED = "2026-09-29T00:00:00.000Z";
const SIZES = { archSlotPx: 192, pathGatePx: 96, minRadiusPx: 180 };

function cluster(id: string, x: number, y: number, portalIds: string[]) {
	return {
		id,
		path: id === "root" ? "." : id,
		label: id,
		pos: { x, y },
		biome: "meadow",
		portalIds,
		chunk: `chunks/${id}.json`,
	};
}

function portal(id: string, clusterId: string) {
	return {
		id,
		clusterId,
		file: { path: id, name: id, kind: "code", bytes: 1, binary: false },
		preview: { lines: [], truncated: false },
		spawns: [],
	};
}

const base = {
	meta: { name: "base", generatedAt: GENERATED, source: "test" },
	clusters: [
		cluster("root", 0, 0, ["a.ts", "b.ts", "c.ts", "d.ts"]),
		cluster("src", 900, 0, ["src/x.ts", "src/y.ts"]),
	],
	portals: [
		portal("a.ts", "root"),
		portal("b.ts", "root"),
		portal("c.ts", "root"),
		portal("d.ts", "root"),
		portal("src/x.ts", "src"),
		portal("src/y.ts", "src"),
	],
	paths: [{ from: "root", to: "src", kind: "trail" }],
	monsters: [
		{
			id: "m1",
			species: "wisp",
			tier: 0,
			portalId: "a.ts",
			error: { code: "x", message: "m" },
		},
	],
} as unknown as WorldManifest;

const delta = {
	layerVersion: 1,
	baseGeneratedAt: GENERATED,
	generatedAt: GENERATED,
	stats: { fileCount: 3, totalBytes: 3, truncated: false, skippedFiles: 0 },
	clusters: [
		cluster("root#shadow", -700, -500, [".env"]),
		cluster(".github", -800, 600, [".github/ci.yml", ".github/owners"]),
	],
	portals: [
		portal(".env", "root#shadow"),
		portal(".github/ci.yml", ".github"),
		portal(".github/owners", ".github"),
	],
	paths: [
		{ from: "root", to: "root#shadow", kind: "trail" },
		{ from: "root", to: ".github", kind: "trail" },
	],
	monsters: [
		{
			id: "m2",
			species: "wisp",
			tier: 0,
			portalId: ".env",
			error: { code: "x", message: "m" },
		},
	],
	extendedMonsters: [],
	signs: [],
	textSha256: { ".env": "0".repeat(64) },
} as unknown as WorldLayerManifest;

function ringAngles(
	manifest: WorldManifest,
	clusterId: string,
	paths: { from: string; to: string }[],
) {
	const c = manifest.clusters.find((x) => x.id === clusterId);
	if (!c) throw new Error(clusterId);
	const angles = paths.map((p) => {
		const other = manifest.clusters.find(
			(x) => x.id === (p.from === clusterId ? p.to : p.from),
		);
		if (!other) throw new Error("dangling");
		return Math.atan2(other.pos.y - c.pos.y, other.pos.x - c.pos.x);
	});
	return layoutPortalRing(c.portalIds.length, angles, SIZES);
}

describe("mergeLayer", () => {
	it("appends the layer after an untouched base and names the layer's ids", () => {
		const merged = mergeLayer(base, delta);
		expect(merged.manifest.clusters.slice(0, 2)).toEqual(base.clusters);
		expect(merged.manifest.portals.slice(0, 6)).toEqual(base.portals);
		expect(merged.manifest.paths.slice(0, 1)).toEqual(base.paths);
		expect(merged.manifest.monsters.map((m) => m.id)).toEqual(["m1", "m2"]);
		expect([...merged.layer.clusterIds]).toEqual(["root#shadow", ".github"]);
		expect([...merged.layer.pathIds]).toEqual([
			"root::root#shadow",
			"root::.github",
		]);
		expect(merged.manifest.meta).toBe(base.meta);
		// The base manifest object itself is never mutated.
		expect(base.clusters).toHaveLength(2);
	});

	it("refuses a layer computed for another base", () => {
		expect(() =>
			mergeLayer(base, {
				...delta,
				baseGeneratedAt: "2020-01-01T00:00:00.000Z",
			}),
		).toThrow(/stale/);
	});

	it("keeps every base arch ring identical: layer paths never gate a base ring", () => {
		const merged = mergeLayer(base, delta);
		for (const c of base.clusters) {
			const without = ringAngles(
				base,
				c.id,
				base.paths.filter((p) => p.from === c.id || p.to === c.id),
			);
			const withLayer = ringAngles(
				merged.manifest,
				c.id,
				ringPathsFor(merged.manifest, c.id, merged.layer),
			);
			expect(withLayer).toEqual(without);
		}
		// Sanity: gating the root's ring with every path would have moved it.
		const naive = ringAngles(
			merged.manifest,
			"root",
			merged.manifest.paths.filter((p) => p.from === "root" || p.to === "root"),
		);
		expect(naive).not.toEqual(
			ringAngles(
				base,
				"root",
				base.paths.filter((p) => p.from === "root"),
			),
		);
	});

	it("a layer cluster's ring gates all of its own paths", () => {
		const merged = mergeLayer(base, delta);
		expect(
			ringPathsFor(merged.manifest, ".github", merged.layer).map(
				(p) => `${p.from}::${p.to}`,
			),
		).toEqual(["root::.github"]);
		expect(ringPathsFor(base, "root", null)).toEqual(base.paths);
	});
});

describe("layerPathRoutes", () => {
	it("leaves the base hub through its widest free gaps, past the ring", () => {
		const merged = mergeLayer(base, delta);
		const rootRing = ringAngles(base, "root", base.paths);
		const routes = layerPathRoutes(merged.manifest, merged.layer, (id) =>
			id === "root"
				? { radius: rootRing.radius, archAngles: rootRing.angles }
				: undefined,
		);
		expect([...routes.keys()].sort()).toEqual([
			"root::.github",
			"root::root#shadow",
		]);
		const bends: number[] = [];
		for (const [key, points] of routes) {
			expect(points).toHaveLength(3);
			expect(points[0]).toEqual({ x: 0, y: 0 });
			const far = merged.manifest.clusters.find(
				(c) => c.id === key.split("::")[1],
			);
			expect(points[2]).toEqual(far?.pos);
			const bend = points[1];
			if (!bend) throw new Error("no bend");
			expect(Math.hypot(bend.x, bend.y)).toBeCloseTo(
				rootRing.radius + LAYER_PATH_GATE_OUT_PX,
			);
			const angle = Math.atan2(bend.y, bend.x);
			bends.push(angle);
			// Never through an arch: clear of every arch by more than half a slot.
			for (const arch of rootRing.angles) {
				const d = Math.abs(
					Math.atan2(Math.sin(angle - arch), Math.cos(angle - arch)),
				);
				expect(d * rootRing.radius).toBeGreaterThan(SIZES.archSlotPx / 2);
			}
		}
		// Two layer paths from one hub take two different gaps.
		expect(bends[0]).not.toBeCloseTo(bends[1] ?? 0);
	});
});

describe("layer helpers", () => {
	it("routes a layer file's save to the layer, never to the save's overrides", () => {
		const { layer } = mergeLayer(base, delta);
		expect(editorSaveTarget(".env", layer)).toBe("layer");
		expect(editorSaveTarget("a.ts", layer)).toBe("override");
		expect(editorSaveTarget(".env", null)).toBe("override");
	});

	it("names the sibling save slot and spots hidden paths", () => {
		expect(layerSaveSlotId("abcd1234", "shadow")).toBe("abcd1234#shadow");
		expect(isHiddenPath(".env")).toBe(true);
		expect(isHiddenPath("src/.eslintrc.json")).toBe(true);
		expect(isHiddenPath("src/a.ts")).toBe(false);
	});

	it("a hidden-folder sign is written by the active layer only", async () => {
		const calls: string[] = [];
		const ownerSigns = {
			save: async () => {
				calls.push("owner");
				return {} as never;
			},
			remove: async () => undefined,
		};
		const provider = {
			id: "shadow",
			saveSign: async () => {
				calls.push("layer");
				return {} as never;
			},
			removeSign: async () => undefined,
		} as unknown as WorldLayerProvider;
		const state = { ownerSigns, worldLayers: [provider], activeLayerId: null };
		expect(signWriterFor(state, ".github/a.seyn")).toBeNull();
		expect(signWriterFor(state, "a.seyn")).toBe(ownerSigns);
		const writer = signWriterFor(
			{ ...state, activeLayerId: "shadow" },
			".github/a.seyn",
		);
		await writer?.save({ path: ".github/a.seyn", content: "", create: true });
		expect(calls).toEqual(["layer"]);
		expect(
			signWriterFor(
				{ ...state, ownerSigns: null, activeLayerId: "shadow" },
				".github/a.seyn",
			),
		).toBeNull();
	});

	it("the map marks the layer's entries", () => {
		const merged = mergeLayer(base, delta);
		const positions = new Map(
			merged.manifest.portals.map((p, i) => [p.id, { x: i, y: i }]),
		);
		const map = summarizeWorldMap(merged.manifest, positions, merged.layer);
		expect(map.clusters.filter((c) => c.layer).map((c) => c.id)).toEqual([
			"root#shadow",
			".github",
		]);
		expect(map.portals.filter((p) => p.layer)).toHaveLength(3);
		expect(map.paths.filter((p) => p.layer)).toHaveLength(2);
		expect(map.monsters.filter((m) => m.layer).map((m) => m.id)).toEqual([
			"m2",
		]);
		const plain = summarizeWorldMap(base, positions);
		expect(plain.clusters.some((c) => c.layer)).toBe(false);
	});
});
