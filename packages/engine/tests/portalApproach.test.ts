import { describe, expect, it } from "vitest";
import {
	distance,
	isWithinRadius,
	newlyApproached,
	type PortalPoint,
} from "../src/systems/portalApproach.js";

describe("distance / isWithinRadius", () => {
	it("computes euclidean distance", () => {
		expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});

	it("treats the boundary itself as within radius (inclusive)", () => {
		expect(isWithinRadius({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
	});

	it("is false just outside the radius", () => {
		expect(isWithinRadius({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.999)).toBe(false);
	});
});

describe("newlyApproached", () => {
	const portals: PortalPoint[] = [
		{ portalId: "a", pos: { x: 0, y: 0 } },
		{ portalId: "b", pos: { x: 1000, y: 0 } },
	];

	it("reports a portal as newly entered when it wasn't previously in range", () => {
		const result = newlyApproached(portals, { x: 5, y: 0 }, 80, new Set());
		expect(result.inRange).toEqual(new Set(["a"]));
		expect(result.entered).toEqual(["a"]);
	});

	it("does not re-report a portal already tracked as in range", () => {
		const result = newlyApproached(portals, { x: 5, y: 0 }, 80, new Set(["a"]));
		expect(result.inRange).toEqual(new Set(["a"]));
		expect(result.entered).toEqual([]);
	});

	it("drops a portal from inRange once the player leaves its radius, without re-entering it", () => {
		const result = newlyApproached(
			portals,
			{ x: 500, y: 0 },
			80,
			new Set(["a"]),
		);
		expect(result.inRange).toEqual(new Set());
		expect(result.entered).toEqual([]);
	});

	it("can report multiple simultaneous approaches", () => {
		const close: PortalPoint[] = [
			{ portalId: "a", pos: { x: 0, y: 0 } },
			{ portalId: "b", pos: { x: 10, y: 0 } },
		];
		const result = newlyApproached(close, { x: 0, y: 0 }, 80, new Set());
		expect(result.entered.sort()).toEqual(["a", "b"]);
	});
});
