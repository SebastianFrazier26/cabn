import { describe, expect, it } from "vitest";
import {
	type EdgeSceneryInput,
	FILLER_KINDS,
	type Footprint,
	footprintClear,
	keepoutDistance,
	planEdgeScenery,
	planLayeredEdgeScenery,
	type SceneryKind,
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
