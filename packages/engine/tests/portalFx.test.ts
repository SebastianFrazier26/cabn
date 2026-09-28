import { describe, expect, test } from "vitest";
import {
	ambientMote,
	edgeGlowAlpha,
	hashSeed,
	LOADING_MOTE_COUNT,
	loadingMote,
	MINI_PAGE_VIRTUAL_WIDTH,
	miniPageScale,
	openingRect,
	pickNearWebPortal,
	projectWorldRect,
	rand01,
	rectContains,
	rectsOverlap,
	resolveProgress,
	sameRect,
	sheenPhase,
	urlArchClickAction,
} from "../src/systems/portalFx.js";

const RECT = { x: 100, y: 200, w: 90, h: 125 };

function inside(m: { x: number; y: number }, r = RECT): boolean {
	return m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
}

describe("seeding", () => {
	test("hashSeed is stable and distinguishes ids", () => {
		expect(hashSeed("a/b.ts")).toBe(hashSeed("a/b.ts"));
		expect(hashSeed("a/b.ts")).not.toBe(hashSeed("a/c.ts"));
	});

	test("rand01 stays in [0, 1) and is deterministic", () => {
		for (let i = 0; i < 200; i++) {
			const v = rand01(1234, i);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
			expect(rand01(1234, i)).toBe(v);
		}
	});
});

describe("loadingMote", () => {
	test("every mote stays inside the opening across a range of times", () => {
		for (let t = 0; t < 10_000; t += 137)
			for (let i = 0; i < LOADING_MOTE_COUNT; i++) {
				const m = loadingMote(42, i, t, RECT, false);
				expect(inside(m)).toBe(true);
				expect(Number.isInteger(m.x) && Number.isInteger(m.y)).toBe(true);
			}
	});

	test("moves over time with motion allowed", () => {
		const a = loadingMote(42, 3, 0, RECT, false);
		const b = loadingMote(42, 3, 400, RECT, false);
		expect(a.x !== b.x || a.y !== b.y).toBe(true);
	});

	test("reduced motion freezes position and alpha", () => {
		const a = loadingMote(42, 3, 0, RECT, true);
		const b = loadingMote(42, 3, 5_000, RECT, true);
		expect(b).toEqual(a);
	});

	test("full spread fades every mote out (the resolve end state)", () => {
		for (let i = 0; i < LOADING_MOTE_COUNT; i++)
			expect(loadingMote(7, i, 1234, RECT, false, 1).alpha).toBe(0);
	});
});

describe("ambientMote", () => {
	test("absent under reduced motion", () => {
		expect(ambientMote(1, 0, 100, RECT, true)).toBeNull();
	});

	test("rises (y decreases) through its period and stays within the opening's width", () => {
		const a = ambientMote(9, 0, 0, RECT, false);
		const b = ambientMote(9, 0, 300, RECT, false);
		expect(a && b).toBeTruthy();
		if (!a || !b) return;
		expect(a.x).toBeGreaterThanOrEqual(RECT.x);
		expect(a.x).toBeLessThanOrEqual(RECT.x + RECT.w);
		// Same particle 300ms later is higher unless it just wrapped to the floor.
		expect(b.y < a.y || b.y > RECT.y + RECT.h - 10).toBe(true);
	});
});

describe("resolve / glow / sheen timing", () => {
	test("resolveProgress is a clamped smoothstep", () => {
		expect(resolveProgress(-10, 500)).toBe(0);
		expect(resolveProgress(0, 500)).toBe(0);
		expect(resolveProgress(250, 500)).toBeCloseTo(0.5);
		expect(resolveProgress(500, 500)).toBe(1);
		expect(resolveProgress(9_999, 500)).toBe(1);
		expect(resolveProgress(0, 0)).toBe(1);
	});

	test("edge glow pulses within bounds, flat under reduced motion", () => {
		for (let t = 0; t < 5_000; t += 97) {
			const a = edgeGlowAlpha(5, t, false);
			expect(a).toBeGreaterThanOrEqual(0.35);
			expect(a).toBeLessThanOrEqual(0.75);
		}
		expect(edgeGlowAlpha(5, 0, true)).toBe(edgeGlowAlpha(5, 777, true));
	});

	test("sheen sweeps part of the time and never under reduced motion", () => {
		let active = 0;
		for (let t = 0; t < 52_000; t += 100)
			if (sheenPhase(3, t, false) !== null) active++;
		expect(active).toBeGreaterThan(0);
		expect(active).toBeLessThan(520 / 2);
		for (let t = 0; t < 10_000; t += 100)
			expect(sheenPhase(3, t, true)).toBeNull();
	});
});

describe("projectWorldRect", () => {
	const camera = {
		view: { x: 500, y: 300, w: 800, h: 600 },
		zoom: 1,
		offsetX: 0,
		offsetY: 0,
	};
	const canvas = { left: 0, top: 0, scaleX: 1, scaleY: 1 };

	test("identity-ish mapping at zoom 1 subtracts the camera's world view", () => {
		expect(
			projectWorldRect({ x: 600, y: 350, w: 90, h: 125 }, camera, canvas),
		).toEqual({ x: 100, y: 50, w: 90, h: 125 });
	});

	test("zoom scales both offset and size", () => {
		expect(
			projectWorldRect(
				{ x: 600, y: 350, w: 90, h: 125 },
				{ ...camera, zoom: 2 },
				canvas,
			),
		).toEqual({ x: 200, y: 100, w: 180, h: 250 });
	});

	test("canvas placement and CSS scale apply after the camera", () => {
		expect(
			projectWorldRect({ x: 600, y: 350, w: 90, h: 125 }, camera, {
				left: 10,
				top: 44,
				scaleX: 0.5,
				scaleY: 0.5,
			}),
		).toEqual({ x: 60, y: 69, w: 45, h: 62.5 });
	});

	test("camera viewport offset shifts the result", () => {
		expect(
			projectWorldRect(
				{ x: 600, y: 350, w: 90, h: 125 },
				{ ...camera, offsetX: 20, offsetY: 5 },
				canvas,
			),
		).toEqual({ x: 120, y: 55, w: 90, h: 125 });
	});
});

describe("rect helpers", () => {
	test("openingRect centres on the arch, shifted by offsetY", () => {
		expect(
			openingRect({ x: 0, y: 0 }, { width: 90, height: 120, offsetY: 30 }),
		).toEqual({ x: -45, y: -30, w: 90, h: 120 });
	});

	test("contains / overlaps", () => {
		expect(rectContains(RECT, { x: 100, y: 200 })).toBe(true);
		expect(rectContains(RECT, { x: 99, y: 200 })).toBe(false);
		expect(rectsOverlap(RECT, { x: 180, y: 300, w: 50, h: 50 })).toBe(true);
		expect(rectsOverlap(RECT, { x: 190, y: 300, w: 50, h: 50 })).toBe(false);
	});

	test("sameRect tolerates sub-half-pixel jitter only", () => {
		expect(sameRect(null, RECT)).toBe(false);
		expect(sameRect(RECT, { ...RECT, x: RECT.x + 0.4 })).toBe(true);
		expect(sameRect(RECT, { ...RECT, x: RECT.x + 0.6 })).toBe(false);
	});

	test("miniPageScale maps the opening to the virtual page width", () => {
		expect(miniPageScale(MINI_PAGE_VIRTUAL_WIDTH / 4)).toBeCloseTo(0.25);
		expect(miniPageScale(0)).toBe(0);
	});
});

describe("pickNearWebPortal", () => {
	test("nearest within radius, null when none", () => {
		const c = [
			{ id: "b", pos: { x: 100, y: 0 } },
			{ id: "a", pos: { x: 50, y: 0 } },
			{ id: "far", pos: { x: 400, y: 0 } },
		];
		expect(pickNearWebPortal(c, { x: 0, y: 0 }, 150)).toBe("a");
		expect(pickNearWebPortal(c, { x: 1000, y: 0 }, 150)).toBeNull();
	});

	test("equidistant ties break on id so the choice never flickers", () => {
		const c = [
			{ id: "z", pos: { x: 100, y: 0 } },
			{ id: "m", pos: { x: -100, y: 0 } },
		];
		expect(pickNearWebPortal(c, { x: 0, y: 0 }, 150)).toBe("m");
		expect(pickNearWebPortal([...c].reverse(), { x: 0, y: 0 }, 150)).toBe("m");
	});
});

describe("urlArchClickAction", () => {
	const arch = { x: 0, y: 0 };
	const opening = { x: -45, y: -30, w: 90, h: 120 };

	test("near + on the opening opens the link", () => {
		expect(
			urlArchClickAction(
				{ x: 0, y: 10 },
				{ x: 0, y: 120 },
				arch,
				opening,
				150,
				true,
			),
		).toBe("open-link");
	});

	test("far away walks even when clicking the opening", () => {
		expect(
			urlArchClickAction(
				{ x: 0, y: 10 },
				{ x: 0, y: 600 },
				arch,
				opening,
				150,
				true,
			),
		).toBe("walk");
	});

	test("near but clicking the stone (outside the opening) walks", () => {
		expect(
			urlArchClickAction(
				{ x: 80, y: -80 },
				{ x: 0, y: 120 },
				arch,
				opening,
				150,
				true,
			),
		).toBe("walk");
	});

	test("a link the guard refused always walks", () => {
		expect(
			urlArchClickAction(
				{ x: 0, y: 10 },
				{ x: 0, y: 120 },
				arch,
				opening,
				150,
				false,
			),
		).toBe("walk");
	});
});
