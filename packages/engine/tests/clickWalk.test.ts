import { describe, expect, it } from "vitest";
import {
	clampToBounds,
	type Interactable,
	resolveClickTarget,
	startProgressWatch,
	steerToward,
	trackProgress,
} from "../src/systems/clickWalk.js";

const portal: Interactable = {
	id: "p1",
	kind: "portal",
	pos: { x: 100, y: 0 },
	hitRadius: 48,
	arriveRadius: 28,
};
const monster: Interactable = {
	id: "m1",
	kind: "monster",
	pos: { x: 110, y: -20 },
	hitRadius: 20,
	arriveRadius: 30,
	priority: 1,
};
const cabin: Interactable = {
	id: "c1",
	kind: "cabin",
	pos: { x: 0, y: -480 },
	hitRadius: 60,
	arriveRadius: 40,
};

describe("resolveClickTarget", () => {
	it("returns a ground target when nothing is under the click", () => {
		expect(resolveClickTarget({ x: 300, y: 300 }, [portal, cabin])).toEqual({
			kind: "ground",
			point: { x: 300, y: 300 },
		});
	});

	it("picks the interactable whose hit area contains the click", () => {
		const result = resolveClickTarget({ x: 20, y: -470 }, [portal, cabin]);
		expect(result).toEqual({ kind: "interactable", target: cabin });
	});

	it("treats the hit radius boundary as inside", () => {
		const result = resolveClickTarget({ x: 148, y: 0 }, [portal]);
		expect(result.kind).toBe("interactable");
	});

	it("prefers higher priority over a nearer centre when hit areas overlap", () => {
		// 5px from the portal's centre but 18px from the monster's — the monster
		// still wins on priority.
		const result = resolveClickTarget({ x: 100, y: -5 }, [portal, monster]);
		expect(result).toEqual({ kind: "interactable", target: monster });
	});

	it("breaks equal-priority ties by nearest centre", () => {
		const other: Interactable = { ...portal, id: "p2", pos: { x: 140, y: 0 } };
		const result = resolveClickTarget({ x: 130, y: 0 }, [portal, other]);
		expect(result).toEqual({ kind: "interactable", target: other });
	});
});

describe("steerToward", () => {
	it("reports arrival inside the arrive radius", () => {
		expect(steerToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 5, 220, 16)).toEqual({
			arrived: true,
			velocity: { x: 0, y: 0 },
		});
	});

	it("heads straight at the goal at full speed when far away", () => {
		const { arrived, velocity } = steerToward(
			{ x: 0, y: 0 },
			{ x: 300, y: 400 },
			4,
			220,
			16,
		);
		expect(arrived).toBe(false);
		expect(velocity.x).toBeCloseTo(0.6);
		expect(velocity.y).toBeCloseTo(0.8);
	});

	it("scales down the final step so it lands on the arrive radius instead of overshooting", () => {
		// 220px/s over 100ms = 22px step; only 10px remain beyond the 4px radius.
		const { velocity } = steerToward(
			{ x: 0, y: 0 },
			{ x: 14, y: 0 },
			4,
			220,
			100,
		);
		expect(velocity.x).toBeCloseTo(10 / 22);
		expect(velocity.y).toBeCloseTo(0);
	});

	it("never exceeds unit speed", () => {
		const { velocity } = steerToward(
			{ x: 0, y: 0 },
			{ x: -1000, y: 0 },
			4,
			220,
			0,
		);
		expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(1);
	});
});

describe("clampToBounds", () => {
	const bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };

	it("leaves an in-bounds point alone", () => {
		expect(clampToBounds({ x: 10, y: 10 }, bounds)).toEqual({ x: 10, y: 10 });
	});

	it("pulls an out-of-bounds point to the edge, minus the inset", () => {
		expect(clampToBounds({ x: 500, y: -500 }, bounds, 12)).toEqual({
			x: 88,
			y: -38,
		});
	});
});

describe("trackProgress", () => {
	it("is never stuck before a full window has elapsed", () => {
		const watch = startProgressWatch({ x: 0, y: 0 });
		const { stuck } = trackProgress(watch, { x: 0, y: 0 }, 499);
		expect(stuck).toBe(false);
	});

	it("flags stuck when a full window passes with almost no movement", () => {
		let watch = startProgressWatch({ x: 0, y: 0 });
		({ watch } = trackProgress(watch, { x: 1, y: 0 }, 300));
		const result = trackProgress(watch, { x: 3, y: 0 }, 300);
		expect(result.stuck).toBe(true);
	});

	it("is not stuck while making headway, and re-anchors each window", () => {
		let watch = startProgressWatch({ x: 0, y: 0 });
		const first = trackProgress(watch, { x: 110, y: 0 }, 500);
		expect(first.stuck).toBe(false);
		watch = first.watch;
		expect(watch.anchor).toEqual({ x: 110, y: 0 });
		const second = trackProgress(watch, { x: 112, y: 0 }, 500);
		expect(second.stuck).toBe(true);
	});
});
