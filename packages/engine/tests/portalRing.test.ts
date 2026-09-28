import { describe, expect, it } from "vitest";
import {
	layoutPortalRing,
	type PortalRing,
	portalRingBaseRadius,
} from "../src/systems/portalRing.js";

const SIZES = { archSlotPx: 192, pathGatePx: 96, minRadiusPx: 180 };
const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;

function angularDistance(a: number, b: number): number {
	const d = (((a - b) % TAU) + TAU) % TAU;
	return Math.min(d, TAU - d);
}

/** Smallest along-the-ring distance (px) from any arch to any path. */
function pathClearance(ring: PortalRing, paths: number[]): number {
	let min = Number.POSITIVE_INFINITY;
	for (const a of ring.angles)
		for (const p of paths)
			min = Math.min(min, angularDistance(a, p) * ring.radius);
	return min;
}

/** Along-the-ring spacing, the same measure the old circumference / count sizing used. */
function minArchSpacing(ring: PortalRing): number {
	let min = Number.POSITIVE_INFINITY;
	for (let i = 0; i < ring.angles.length; i++)
		for (let j = i + 1; j < ring.angles.length; j++) {
			const d = angularDistance(ring.angles[i] ?? 0, ring.angles[j] ?? 0);
			min = Math.min(min, d * ring.radius);
		}
	return min;
}

const REQUIRED_CLEARANCE = (SIZES.archSlotPx + SIZES.pathGatePx) / 2;

describe("layoutPortalRing", () => {
	it("keeps the old evenly-spaced, top-first ring when no path leaves the hub", () => {
		const ring = layoutPortalRing(4, [], SIZES);
		expect(ring.radius).toBe(180);
		expect(ring.angles).toEqual([-Math.PI / 2, 0, Math.PI / 2, Math.PI]);
	});

	// The playtest's "linked to just a portal": a one-file cluster ("docs")
	// directly below the root. Its lone arch always went at the top — exactly
	// where the path from the root arrives — so the path ended at the arch.
	it("puts a lone arch opposite the single path into its cluster", () => {
		const ring = layoutPortalRing(1, [-Math.PI / 2], SIZES);
		expect(angularDistance(ring.angles[0] ?? 0, Math.PI / 2)).toBeLessThan(
			1e-9,
		);
	});

	it("keeps two arches off an incoming path and symmetric about it", () => {
		const ring = layoutPortalRing(2, [deg(200)], SIZES);
		expect(pathClearance(ring, [deg(200)])).toBeGreaterThanOrEqual(
			REQUIRED_CLEARANCE,
		);
		const [a = 0, b = 0] = ring.angles;
		expect(angularDistance(a, deg(200))).toBeCloseTo(
			angularDistance(b, deg(200)),
		);
	});

	// The demo root: four files and eight paths fanning out evenly. At the old
	// fixed 180px ring every arch landed across one of the paths.
	it("threads the root's arches between eight evenly spread paths", () => {
		const paths = Array.from({ length: 8 }, (_, i) => deg(5 + i * 45));
		const ring = layoutPortalRing(4, paths, SIZES);
		expect(ring.angles).toHaveLength(4);
		expect(pathClearance(ring, paths)).toBeGreaterThanOrEqual(
			REQUIRED_CLEARANCE - 1e-6,
		);
		expect(minArchSpacing(ring)).toBeGreaterThanOrEqual(SIZES.archSlotPx);
		expect(ring.radius).toBeGreaterThanOrEqual(
			portalRingBaseRadius(4, 8, SIZES),
		);
	});

	it("grows the ring when paths bunch up and leave too little arc", () => {
		const paths = [deg(0), deg(15), deg(30), deg(45), deg(60), deg(75)];
		const ring = layoutPortalRing(9, paths, SIZES);
		expect(ring.angles).toHaveLength(9);
		expect(pathClearance(ring, paths)).toBeGreaterThanOrEqual(
			REQUIRED_CLEARANCE - 1e-6,
		);
		expect(minArchSpacing(ring)).toBeGreaterThanOrEqual(
			SIZES.archSlotPx - 1e-6,
		);
	});

	it("never lets arches overlap or cover a path, across many shapes", () => {
		for (let portals = 1; portals <= 14; portals++) {
			for (let pathCount = 1; pathCount <= 7; pathCount++) {
				const paths = Array.from({ length: pathCount }, (_, i) =>
					deg((i * 137 + portals * 31) % 360),
				);
				const ring = layoutPortalRing(portals, paths, SIZES);
				expect(ring.angles).toHaveLength(portals);
				expect(pathClearance(ring, paths)).toBeGreaterThanOrEqual(
					REQUIRED_CLEARANCE - 1e-6,
				);
				if (portals > 1)
					expect(minArchSpacing(ring)).toBeGreaterThanOrEqual(
						SIZES.archSlotPx - 1e-6,
					);
			}
		}
	});

	it("orders arches clockwise from the top so portal order reads the same way round every ring", () => {
		const ring = layoutPortalRing(5, [deg(10), deg(250)], SIZES);
		const fromTop = ring.angles.map(
			(a) => (((a + Math.PI / 2) % TAU) + TAU) % TAU,
		);
		expect([...fromTop].sort((a, b) => a - b)).toEqual(fromTop);
	});

	it("is deterministic", () => {
		const paths = [deg(33), deg(140), deg(290)];
		expect(layoutPortalRing(6, paths, SIZES)).toEqual(
			layoutPortalRing(6, paths, SIZES),
		);
	});
});
