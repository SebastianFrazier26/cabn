import { describe, expect, it } from "vitest";
import {
	motionOffset,
	motionProfile,
	orbitAngle,
	pathFigureEight,
	portalOrbitEllipse,
	portalOrbitSeed,
	resolveMonsterSpecies,
	sampleOrbit,
	staticOrbitAngle,
} from "../src/systems/monsterOrbit.js";

const TAU = Math.PI * 2;
const ARCH = 192;
const ellipse = portalOrbitEllipse({ x: 100, y: 200 }, ARCH);

describe("portalOrbitEllipse", () => {
	it("circles just outside the arch's visible stone, below its centre, flattened", () => {
		expect(ellipse.cx).toBe(100);
		expect(ellipse.cy).toBeGreaterThan(200);
		// visible stone is ~0.39x the frame each side of centre
		expect(ellipse.rx).toBeGreaterThan(ARCH * 0.39);
		expect(ellipse.ry).toBeLessThan(ellipse.rx / 2);
	});
});

describe("sampleOrbit", () => {
	it("is in front of the arch on the near (lower) half and behind on the far half", () => {
		const near = sampleOrbit(ellipse, Math.PI / 2);
		const far = sampleOrbit(ellipse, -Math.PI / 2);
		expect(near.inFront).toBe(true);
		expect(near.y).toBeCloseTo(ellipse.cy + ellipse.ry);
		expect(far.inFront).toBe(false);
		expect(far.y).toBeCloseTo(ellipse.cy - ellipse.ry);
		expect(near.scale).toBeGreaterThan(far.scale);
	});

	it("reports horizontal travel direction for flipping, reversed by the orbit direction", () => {
		// At the near point (θ=π/2) increasing θ moves left.
		expect(sampleOrbit(ellipse, Math.PI / 2, 1).travelX).toBe(-1);
		expect(sampleOrbit(ellipse, Math.PI / 2, -1).travelX).toBe(1);
	});

	it("scales the radius for a species' breathing wobble", () => {
		const s = sampleOrbit(ellipse, 0, 1, 1.1);
		expect(s.x).toBeCloseTo(ellipse.cx + ellipse.rx * 1.1);
	});
});

describe("orbitAngle", () => {
	it("spaces siblings evenly in phase and keeps that spacing over time", () => {
		for (const t of [0, 3.7, 12]) {
			const a = orbitAngle(0, 3, t, 0.55, 1, 0.4);
			const b = orbitAngle(1, 3, t, 0.55, 1, 0.4);
			const c = orbitAngle(2, 3, t, 0.55, 1, 0.4);
			expect(b - a).toBeCloseTo(TAU / 3);
			expect(c - b).toBeCloseTo(TAU / 3);
		}
	});

	it("advances with time in the given direction", () => {
		expect(orbitAngle(0, 1, 2, 0.5, 1, 0)).toBeCloseTo(1);
		expect(orbitAngle(0, 1, 2, 0.5, -1, 0)).toBeCloseTo(-1);
	});

	it("treats a zero count as one", () => {
		expect(orbitAngle(0, 0, 0, 1, 1, 0)).toBe(0);
	});
});

describe("staticOrbitAngle (reduced motion)", () => {
	it("keeps every monster on the near half so none parks behind the arch", () => {
		for (const count of [1, 2, 3, 5]) {
			for (let i = 0; i < count; i++) {
				const s = sampleOrbit(ellipse, staticOrbitAngle(i, count));
				expect(s.y).toBeGreaterThanOrEqual(ellipse.cy - ellipse.ry * 0.1);
			}
		}
	});

	it("spreads siblings apart", () => {
		const xs = [0, 1, 2].map(
			(i) => sampleOrbit(ellipse, staticOrbitAngle(i, 3)).x,
		);
		expect(new Set(xs.map((x) => Math.round(x))).size).toBe(3);
	});
});

describe("portalOrbitSeed", () => {
	it("is deterministic per portal and varies across portals", () => {
		expect(portalOrbitSeed("a.ts")).toEqual(portalOrbitSeed("a.ts"));
		const seeds = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"].map(portalOrbitSeed);
		expect(new Set(seeds.map((s) => s.offset)).size).toBe(5);
		for (const s of seeds) {
			expect(s.offset).toBeGreaterThanOrEqual(0);
			expect(s.offset).toBeLessThan(TAU);
		}
	});
});

describe("pathFigureEight", () => {
	it("crosses the centre and reaches halfLength along the path direction", () => {
		const c = { x: 10, y: 20 };
		const ends = pathFigureEight(c, 0, 70, 0);
		expect(ends.x).toBeCloseTo(80);
		expect(ends.y).toBeCloseTo(20);
		const mid = pathFigureEight(c, 0, 70, Math.PI / 2);
		expect(mid.x).toBeCloseTo(10);
		expect(mid.y).toBeCloseTo(20);
	});

	it("rotates with the path", () => {
		const p = pathFigureEight({ x: 0, y: 0 }, Math.PI / 2, 70, 0);
		expect(p.x).toBeCloseTo(0);
		expect(p.y).toBeCloseTo(70);
	});
});

describe("motion profiles", () => {
	it("hops never dip below the orbit line; drifts go both ways", () => {
		const hop = motionProfile("rot-sprite");
		const drift = motionProfile("ghost");
		let hopMax = Number.NEGATIVE_INFINITY;
		let driftMin = Number.POSITIVE_INFINITY;
		let driftMax = Number.NEGATIVE_INFINITY;
		for (let t = 0; t < 4; t += 0.05) {
			hopMax = Math.max(hopMax, motionOffset(hop, t, 0.3).dy);
			const d = motionOffset(drift, t, 0.3).dy;
			driftMin = Math.min(driftMin, d);
			driftMax = Math.max(driftMax, d);
		}
		expect(hopMax).toBeLessThanOrEqual(0);
		expect(driftMin).toBeLessThan(0);
		expect(driftMax).toBeGreaterThan(0);
	});

	it("wisps flicker within [0,1] alpha; steady species hold their base alpha", () => {
		const wisp = motionProfile("will-o-wisp");
		const alphas = new Set<number>();
		for (let t = 0; t < 3; t += 0.1) {
			const a = motionOffset(wisp, t, 0).alpha;
			expect(a).toBeGreaterThanOrEqual(0);
			expect(a).toBeLessThanOrEqual(1);
			alphas.add(Math.round(a * 100));
		}
		expect(alphas.size).toBeGreaterThan(3);
		expect(motionOffset(motionProfile("gremlin"), 1.3, 0).alpha).toBe(1);
	});

	it("the ouroboros spins continuously", () => {
		const o = motionProfile("ouroboros");
		expect(motionOffset(o, 10, 0).rotation).toBeGreaterThan(
			motionOffset(o, 1, 0).rotation,
		);
	});

	it("unknown species move like a shade", () => {
		expect(motionProfile("some-future-species")).toEqual(
			motionProfile("shade"),
		);
	});
});

describe("resolveMonsterSpecies", () => {
	it("keeps a species whose art loaded", () => {
		expect(resolveMonsterSpecies("imp", () => true)).toBe("imp");
	});

	it("falls back to shade, then ghost", () => {
		expect(resolveMonsterSpecies("mystery", (s) => s === "shade")).toBe(
			"shade",
		);
		expect(resolveMonsterSpecies("mystery", () => false)).toBe("ghost");
		expect(resolveMonsterSpecies("imp", (s) => s === "ghost")).toBe("ghost");
	});
});
