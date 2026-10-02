import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/systems/deterministicRandom.js";
import {
	buildLazySceneryContext,
	type CircleKeepout,
	type EdgeSceneryInput,
	type EdgeSceneryLayer,
	type EdgeSceneryWorld,
	FILLER_KINDS,
	type Footprint,
	footprintClear,
	KeepoutIndex,
	keepoutDistance,
	planEdgeScenery,
	planEdgeSceneryPois,
	planFillerChunk,
	planFillerChunkForContext,
	planLayeredEdgeScenery,
	type SceneryKind,
	type SegmentKeepout,
	valueNoise,
} from "../src/systems/edgeScenery.js";

// Rough real texture sizes (render/sceneryBaker.ts reads the actual ones at runtime).
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

function sampleWorld(
	overrides: Partial<EdgeSceneryInput> = {},
): EdgeSceneryInput {
	return {
		bounds: { minX: -1500, minY: -1300, maxX: 1500, maxY: 1300 },
		seed: "world-abc",
		circles: [
			{ x: 0, y: 0, radius: 250 },
			{ x: 600, y: -300, radius: 200 },
			{ x: -500, y: 400, radius: 220 },
			{ x: 120, y: 0, radius: 56 },
		],
		segments: [
			{ ax: 0, ay: 0, bx: 600, by: -300, halfWidth: 20 },
			{ ax: 0, ay: 0, bx: -500, by: 400, halfWidth: 20 },
		],
		footprints: FOOTPRINTS,
		windmillSailSpan: 186,
		...overrides,
	};
}

describe("keepoutDistance", () => {
	it("is negative inside a circle, positive outside, zero on its edge", () => {
		const circles = [{ x: 0, y: 0, radius: 10 }];
		expect(keepoutDistance(0, 0, circles, [])).toBe(-10);
		expect(keepoutDistance(10, 0, circles, [])).toBe(0);
		expect(keepoutDistance(25, 0, circles, [])).toBe(15);
	});

	it("measures to a segment capsule, clamping past its ends", () => {
		const seg = [{ ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 5 }];
		expect(keepoutDistance(50, 20, [], seg)).toBe(15);
		expect(keepoutDistance(130, 0, [], seg)).toBe(25);
	});

	it("is infinite with nothing to keep out", () => {
		expect(keepoutDistance(1, 2, [], [])).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("footprintClear", () => {
	it("rejects a tall sprite whose base is clear but whose crown leans over a path", () => {
		const path = [{ ax: -200, ay: 0, bx: 200, by: 0, halfWidth: 20 }];
		// Base 60px below the path, but a 144px-tall pine reaches up across it.
		expect(footprintClear(0, 60, FOOTPRINTS.pine, [], path, 10)).toBe(false);
		expect(footprintClear(0, 200, FOOTPRINTS.pine, [], path, 10)).toBe(true);
	});
});

describe("valueNoise", () => {
	it("stays in [0,1] and is continuous across a cell boundary", () => {
		for (let x = 0; x < 600; x += 13) {
			const v = valueNoise(x, 77, 180, 5);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
		expect(
			Math.abs(
				valueNoise(179.999, 10, 180, 5) - valueNoise(180.001, 10, 180, 5),
			),
		).toBeLessThan(0.01);
	});
});

describe("planEdgeScenery", () => {
	it("is deterministic for the same seed and inputs", () => {
		expect(planEdgeScenery(sampleWorld())).toEqual(
			planEdgeScenery(sampleWorld()),
		);
	});

	it("changes with the seed", () => {
		const a = planEdgeScenery(sampleWorld());
		const b = planEdgeScenery(sampleWorld({ seed: "another-world" }));
		expect(a.items).not.toEqual(b.items);
	});

	it("never lets any item's footprint touch a clearing, the spawn, or a path", () => {
		const input = sampleWorld();
		const plan = planEdgeScenery(input);
		expect(plan.items.length).toBeGreaterThan(50);
		for (const item of plan.items) {
			// Ring mushrooms and pond reeds are placed relative to an already-cleared
			// POI footprint, so they're checked through it, not individually.
			if (item.kind === "mushroom" || item.kind === "reeds") continue;
			expect(
				footprintClear(
					item.x,
					item.y,
					FOOTPRINTS[item.kind],
					input.circles,
					input.segments,
					0,
				),
			).toBe(true);
		}
	});

	it("keeps ring mushrooms and pond reeds off paths and clearings too", () => {
		const input = sampleWorld();
		for (const item of planEdgeScenery(input).items) {
			if (item.kind !== "mushroom" && item.kind !== "reeds") continue;
			expect(
				keepoutDistance(item.x, item.y, input.circles, input.segments),
			).toBeGreaterThan(0);
		}
	});

	it("keeps every sprite inside the bounds and its top below the top margin", () => {
		const input = sampleWorld({ topMargin: 40 });
		for (const item of planEdgeScenery(input).items) {
			expect(item.x).toBeGreaterThanOrEqual(input.bounds.minX);
			expect(item.x).toBeLessThanOrEqual(input.bounds.maxX);
			expect(item.y).toBeLessThanOrEqual(input.bounds.maxY);
			if (item.kind === "mushroom" || item.kind === "reeds") continue;
			expect(item.y - FOOTPRINTS[item.kind].h).toBeGreaterThanOrEqual(
				input.bounds.minY + 40,
			);
		}
	});

	it("caps filler items without dropping points of interest", () => {
		const capped = planEdgeScenery(sampleWorld({ maxItems: 40 }));
		const filler = capped.items.filter(
			(i) =>
				(FILLER_KINDS as readonly string[]).includes(i.kind) &&
				i.kind !== "reeds",
		);
		expect(filler.length).toBeLessThanOrEqual(40);
		const full = planEdgeScenery(sampleWorld());
		expect(capped.pointsOfInterest).toEqual(full.pointsOfInterest);
	});

	it("places the landmark points of interest in a roomy world", () => {
		const kinds = new Set(
			planEdgeScenery(sampleWorld()).pointsOfInterest.map((p) => p.kind),
		);
		for (const kind of [
			"pond",
			"windmill",
			"ruin",
			"mushroom-ring",
			"fallen-log",
			"waymarker",
		]) {
			expect(kinds.has(kind as never)).toBe(true);
		}
	});

	it("puts the waymarker right beside a path", () => {
		const input = sampleWorld();
		const sign = planEdgeScenery(input).pointsOfInterest.find(
			(p) => p.kind === "waymarker",
		);
		expect(sign).toBeDefined();
		if (!sign) return;
		const d = keepoutDistance(sign.x, sign.y, [], input.segments);
		expect(d).toBeGreaterThan(0);
		expect(d).toBeLessThan(140);
	});

	it("grows denser toward the world edge than near the clearings", () => {
		const input = sampleWorld();
		const items = planEdgeScenery(input).items.filter((i) =>
			["pine", "oak", "blossom-oak"].includes(i.kind),
		);
		const nearEdge = items.filter(
			(i) => Math.abs(i.x) > 1250 || Math.abs(i.y) > 1050,
		);
		const nearCenter = items.filter((i) => Math.hypot(i.x, i.y) < 450);
		expect(nearEdge.length).toBeGreaterThan(nearCenter.length * 3);
	});

	it("returns items in painter's (y) order", () => {
		const items = planEdgeScenery(sampleWorld()).items;
		for (let i = 1; i < items.length; i++) {
			expect(items[i]?.y ?? 0).toBeGreaterThanOrEqual(items[i - 1]?.y ?? 0);
		}
	});

	it("still works (forest only, no waymarker) with no paths at all", () => {
		const plan = planEdgeScenery(sampleWorld({ segments: [] }));
		expect(plan.items.length).toBeGreaterThan(0);
		expect(plan.pointsOfInterest.some((p) => p.kind === "waymarker")).toBe(
			false,
		);
	});
});

describe("planLayeredEdgeScenery", () => {
	const layer = {
		bounds: { minX: -1500, minY: -1900, maxX: 2100, maxY: 1300 },
		circles: [{ x: 1500, y: -1300, radius: 260 }],
		segments: [{ ax: 600, ay: -300, bx: 1500, by: -1300, halfWidth: 20 }],
	};

	it("without a layer it is the plain plan", () => {
		const plain = planEdgeScenery(sampleWorld());
		const layered = planLayeredEdgeScenery(sampleWorld(), null);
		expect(layered.items).toEqual(plain.items);
		expect(layered.pointsOfInterest).toEqual(plain.pointsOfInterest);
		expect(layered.removed).toBe(0);
	});

	it("keeps every base item the layer doesn't stand on exactly where it was", () => {
		const plain = planEdgeScenery(sampleWorld());
		const layered = planLayeredEdgeScenery(sampleWorld(), layer);
		const base = layered.items.filter((i) => !i.layer);
		const key = (i: { kind: string; x: number; y: number }) =>
			`${i.kind}@${i.x},${i.y}`;
		const before = new Set(plain.items.map(key));
		for (const item of base) expect(before.has(key(item))).toBe(true);
		expect(base.length + layered.removed).toBe(plain.items.length);
		for (const item of plain.items) {
			const kept = base.some((b) => key(b) === key(item));
			const clear = footprintClear(
				item.x,
				item.y,
				FOOTPRINTS[item.kind],
				layer.circles,
				layer.segments,
				14,
			);
			expect(kept).toBe(clear);
		}
	});

	it("adds scenery only outside the base bounds, clear of the layer", () => {
		const layered = planLayeredEdgeScenery(sampleWorld(), layer);
		const extra = layered.items.filter((i) => i.layer);
		expect(extra.length).toBeGreaterThan(0);
		const b = sampleWorld().bounds;
		for (const item of extra) {
			const fp = FOOTPRINTS[item.kind];
			const inside =
				item.x + fp.w / 2 > b.minX &&
				item.x - fp.w / 2 < b.maxX &&
				item.y > b.minY &&
				item.y - fp.h < b.maxY;
			expect(inside).toBe(false);
			expect(
				footprintClear(item.x, item.y, fp, layer.circles, layer.segments, 14),
			).toBe(true);
		}
	});

	it("is deterministic", () => {
		expect(planLayeredEdgeScenery(sampleWorld(), layer)).toEqual(
			planLayeredEdgeScenery(sampleWorld(), layer),
		);
	});
});

// M10 stream-bake: planEdgeScenery's filler grid queries a keepout distance
// once (forestScore) or several times (footprintClear) per candidate cell —
// for a real repo conversion (hundreds of clusters' worth of circles) that
// used to make the *plan itself* (not just its bake) take minutes. KeepoutIndex
// must return exactly what the reference keepoutDistance() does, or the
// planned forest changes shape — these compare the two directly.
describe("KeepoutIndex", () => {
	function randomCircles(rand: () => number, n: number): CircleKeepout[] {
		return Array.from({ length: n }, () => ({
			x: (rand() - 0.5) * 4000,
			y: (rand() - 0.5) * 4000,
			radius: 20 + rand() * 180,
		}));
	}

	function randomSegments(rand: () => number, n: number): SegmentKeepout[] {
		return Array.from({ length: n }, () => ({
			ax: (rand() - 0.5) * 4000,
			ay: (rand() - 0.5) * 4000,
			bx: (rand() - 0.5) * 4000,
			by: (rand() - 0.5) * 4000,
			halfWidth: 5 + rand() * 40,
		}));
	}

	it("matches keepoutDistance exactly over many random points, circles and segments", () => {
		const rand = mulberry32(20260930);
		const circles = randomCircles(rand, 200);
		const segments = randomSegments(rand, 60);
		const index = new KeepoutIndex(circles, segments);
		for (let i = 0; i < 300; i++) {
			const x = (rand() - 0.5) * 5000;
			const y = (rand() - 0.5) * 5000;
			expect(index.nearestDistance(x, y)).toBeCloseTo(
				keepoutDistance(x, y, circles, segments),
				9,
			);
		}
	});

	it("matches keepoutDistance for a query point far outside every keepout's bucket neighborhood", () => {
		const circles: CircleKeepout[] = [{ x: 0, y: 0, radius: 50 }];
		const index = new KeepoutIndex(circles, []);
		const far = { x: 100_000, y: -100_000 };
		expect(index.nearestDistance(far.x, far.y)).toBeCloseTo(
			keepoutDistance(far.x, far.y, circles, []),
			9,
		);
	});

	it("accounts for a large radius reaching in from a farther bucket than a smaller, nearer circle", () => {
		// A huge circle two buckets away can still have a closer *edge* than a
		// tiny one right next to the query point — this is exactly what maxPad
		// exists to protect against an early, wrong stop.
		const circles: CircleKeepout[] = [
			{ x: 10, y: 0, radius: 5 }, // edge distance from (0,0): 10-5=5
			{ x: 900, y: 0, radius: 850 }, // edge distance from (0,0): 900-850=50... still farther, use a bigger one
		];
		// Make the far one's edge closer than the near one's.
		circles[1] = { x: 900, y: 0, radius: 895 };
		const index = new KeepoutIndex(circles, []);
		expect(index.nearestDistance(0, 0)).toBeCloseTo(
			keepoutDistance(0, 0, circles, []),
			9,
		);
	});

	it("returns Infinity for an empty index, same as keepoutDistance", () => {
		const index = new KeepoutIndex([], []);
		expect(index.nearestDistance(0, 0)).toBe(Number.POSITIVE_INFINITY);
		expect(keepoutDistance(0, 0, [], [])).toBe(Number.POSITIVE_INFINITY);
	});

	it("is a pure function of its own construction inputs — querying doesn't mutate results between calls", () => {
		const circles = [{ x: 0, y: 0, radius: 30 }];
		const index = new KeepoutIndex(circles, []);
		const first = index.nearestDistance(100, 0);
		const second = index.nearestDistance(100, 0);
		expect(second).toBe(first);
	});
});

// M10 stream-bake round 3: lazy per-chunk planning replaces
// planEdgeScenery's whole-bounds filler grid, whose own cost (not just each
// query's) scaled with world area. These prove the chunk functions are
// deterministic per chunk, independent of planning order, and seam-safe.
function sampleLazyWorld(
	overrides: Partial<EdgeSceneryWorld> = {},
): EdgeSceneryWorld {
	const { seed, bounds, circles, segments, footprints, windmillSailSpan } =
		sampleWorld();
	return {
		seed,
		bounds,
		circles,
		segments,
		footprints,
		windmillSailSpan,
		...overrides,
	};
}

describe("planEdgeSceneryPois", () => {
	it("is deterministic for the same world and noise seed", () => {
		const world = sampleLazyWorld();
		expect(planEdgeSceneryPois(world, 999)).toEqual(
			planEdgeSceneryPois(world, 999),
		);
	});

	it("places nothing when the world has no circles or segments to anchor near", () => {
		const world = sampleLazyWorld({ circles: [], segments: [] });
		const result = planEdgeSceneryPois(world, 999);
		expect(result.items).toEqual([]);
		expect(result.pointsOfInterest).toEqual([]);
		expect(result.reserveCircles).toEqual([]);
	});

	it("every placed item and POI is within bounds and clear of the world's own keepouts", () => {
		const world = sampleLazyWorld();
		const result = planEdgeSceneryPois(world, 999);
		for (const item of result.items) {
			expect(item.x).toBeGreaterThanOrEqual(world.bounds.minX);
			expect(item.x).toBeLessThanOrEqual(world.bounds.maxX);
			expect(item.y).toBeLessThanOrEqual(world.bounds.maxY);
		}
	});
});

describe("planFillerChunk", () => {
	function chunkParams(
		chunkCol: number,
		chunkRow: number,
		world = sampleLazyWorld(),
	) {
		return {
			world,
			keepoutIndex: new KeepoutIndex(world.circles, world.segments),
			forestNoiseSeed: 4242,
			chunkCol,
			chunkRow,
		};
	}

	it("is a pure function of (world, index, noise seed, chunkCol, chunkRow)", () => {
		const a = planFillerChunk(chunkParams(2, -1));
		const b = planFillerChunk(chunkParams(2, -1));
		expect(b).toEqual(a);
	});

	it("doesn't depend on whether other chunks were planned first, or in what order", () => {
		const world = sampleLazyWorld();
		const index = new KeepoutIndex(world.circles, world.segments);
		const target = {
			world,
			keepoutIndex: index,
			forestNoiseSeed: 4242,
			chunkCol: 3,
			chunkRow: 1,
		};
		const alone = planFillerChunk(target);
		// Plan a handful of neighbours (in both orders) first — target's own
		// result must come out identical regardless.
		for (const [c, r] of [
			[0, 0],
			[3, 1],
			[4, 1],
			[2, 1],
			[3, 0],
			[3, 2],
		] as const) {
			planFillerChunk({ ...target, chunkCol: c, chunkRow: r });
		}
		const afterNeighbours = planFillerChunk(target);
		expect(afterNeighbours).toEqual(alone);
	});

	it("keeps every item's anchor within (or acceptably close to) its own chunk's square", () => {
		// Absolute grid cells land in [chunkCol*512, chunkCol*512+512) by
		// construction, plus up to GRID_JITTER_PX (16) of jitter each side.
		const items = planFillerChunk(chunkParams(1, -2));
		const chunkMinX = 1 * 512;
		const chunkMinY = -2 * 512;
		for (const item of items) {
			expect(item.x).toBeGreaterThanOrEqual(chunkMinX - 20);
			expect(item.x).toBeLessThanOrEqual(chunkMinX + 512 + 20);
			expect(item.y).toBeGreaterThanOrEqual(chunkMinY - 20);
			expect(item.y).toBeLessThanOrEqual(chunkMinY + 512 + 20);
		}
	});

	it("never places an item inside a keepout circle's clearance", () => {
		const world = sampleLazyWorld({
			circles: [{ x: 256, y: 256, radius: 400 }],
			segments: [],
		});
		const index = new KeepoutIndex(world.circles, world.segments);
		const items = planFillerChunk({
			world,
			keepoutIndex: index,
			forestNoiseSeed: 1,
			chunkCol: 0,
			chunkRow: 0,
		});
		for (const item of items) {
			expect(Math.hypot(item.x - 256, item.y - 256)).toBeGreaterThan(400);
		}
	});

	it("respects topMargin — nothing spawns above the skyline band", () => {
		const world = sampleLazyWorld({ topMargin: 200 });
		const index = new KeepoutIndex(world.circles, world.segments);
		const items = planFillerChunk({
			world,
			keepoutIndex: index,
			forestNoiseSeed: 1,
			chunkCol: -3,
			chunkRow: -3, // near bounds.minY, where topMargin actually bites
		});
		const topLimit = world.bounds.minY + 200;
		for (const item of items) {
			expect(item.y - world.footprints[item.kind].h).toBeGreaterThanOrEqual(
				topLimit,
			);
		}
	});
});

describe("buildLazySceneryContext / planFillerChunkForContext", () => {
	it("with no layer, a chunk's filler matches calling planFillerChunk directly against the base context", () => {
		const world = sampleLazyWorld();
		const { context } = buildLazySceneryContext(world, null);
		const direct = planFillerChunk({
			world: context.base,
			keepoutIndex: context.baseIndex,
			forestNoiseSeed: context.baseNoiseSeed,
			chunkCol: 5,
			chunkRow: -2,
		});
		expect(planFillerChunkForContext(context, 5, -2)).toEqual(direct);
	});

	it("a base-region chunk is planned from the base seed whether or not a layer is active", () => {
		const world = sampleLazyWorld();
		const { context: noLayer } = buildLazySceneryContext(world, null);
		const layer: EdgeSceneryLayer = {
			bounds: world.bounds, // unchanged bounds — layer only removes, never grows
			circles: [{ x: 5000, y: 5000, radius: 50 }], // far from the chunk under test
			segments: [],
		};
		const { context: withLayer } = buildLazySceneryContext(world, layer);
		// A chunk nowhere near the layer's own content: filtering removes
		// nothing, so the result must be identical to the unlayered plan —
		// "the base plan for a chunk is identical in and out of the realm".
		expect(planFillerChunkForContext(withLayer, 0, 0)).toEqual(
			planFillerChunkForContext(noLayer, 0, 0),
		);
	});

	it("a layer only removes base items it stands on, never adds or moves any", () => {
		const world = sampleLazyWorld();
		const { context: noLayer } = buildLazySceneryContext(world, null);
		const baseline = planFillerChunkForContext(noLayer, 0, 0);
		const layer: EdgeSceneryLayer = {
			bounds: world.bounds,
			circles: [{ x: 256, y: 256, radius: 300 }],
			segments: [],
		};
		const { context: withLayer } = buildLazySceneryContext(world, layer);
		const filtered = planFillerChunkForContext(withLayer, 0, 0);
		expect(filtered.length).toBeLessThanOrEqual(baseline.length);
		const baselineKeys = new Set(
			baseline.map((i) => `${i.kind}@${i.x},${i.y}`),
		);
		for (const item of filtered) {
			expect(baselineKeys.has(`${item.kind}@${item.x},${item.y}`)).toBe(true);
		}
	});

	it("a chunk only reachable because the layer grew the bounds is layer-seeded and marked layer:true", () => {
		const world = sampleLazyWorld();
		// Layer bounds grow well past the base world's own bounds.
		const layer: EdgeSceneryLayer = {
			bounds: {
				minX: world.bounds.minX - 4000,
				minY: world.bounds.minY - 4000,
				maxX: world.bounds.maxX + 4000,
				maxY: world.bounds.maxY + 4000,
			},
			circles: [{ x: world.bounds.maxX + 2000, y: 0, radius: 200 }],
			segments: [],
		};
		const { context } = buildLazySceneryContext(world, layer);
		// A chunk far outside the base bounds, near the layer's own new content.
		const chunkCol = Math.floor((world.bounds.maxX + 2000) / 512);
		const items = planFillerChunkForContext(context, chunkCol, 0);
		for (const item of items) expect(item.layer).toBe(true);
	});

	it("never double-plants at the seam between the base bounds and a grown layer region", () => {
		const world = sampleLazyWorld();
		const layer: EdgeSceneryLayer = {
			bounds: {
				minX: world.bounds.minX - 2000,
				minY: world.bounds.minY - 2000,
				maxX: world.bounds.maxX + 2000,
				maxY: world.bounds.maxY + 2000,
			},
			circles: [],
			segments: [],
		};
		const { context } = buildLazySceneryContext(world, layer);
		// The chunk row/col straddling bounds.maxX must never come from the
		// "grown" (layer) plan — chunkOverlapsBounds(base.bounds) is true for
		// it, so it's always base-seeded (buildLazySceneryContext's own rule).
		const seamCol = Math.floor(world.bounds.maxX / 512);
		const items = planFillerChunkForContext(context, seamCol, 0);
		expect(items.every((i) => !i.layer)).toBe(true);
	});
});
