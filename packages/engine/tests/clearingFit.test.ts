import { CLEARING_HEIGHT_OVERSHOOT_PX } from "@cabn/converter/browser";
import {
	CLEARING_FIT_MARGIN_PX,
	clearingRadiusYForRing,
	GROUND_RADIUS_Y_RATIO,
	WORLD_ARCH_FOOTPRINT,
} from "@cabn/converter/core";
import { describe, expect, it } from "vitest";
import { PORTAL_ARCH_FRAME_SIZE } from "../src/assetPaths.js";
import { WORLD_PORTAL_SCALE } from "../src/render/scale.js";
import {
	layoutPortalRing,
	type PortalRing,
} from "../src/systems/portalRing.js";

// WorldScene's PORTAL_RING_SIZES and CLEARING_OUTER_MARGIN.
const SIZES = { archSlotPx: 192, pathGatePx: 96, minRadiusPx: 180 };
const OUTER_MARGIN = 90;
const HALF_ARCH = (PORTAL_ARCH_FRAME_SIZE * WORLD_PORTAL_SCALE) / 2;
// The arch's full measured silhouette (clearingFit.ts's comment): finial,
// shoulders, base corners, around its centre.
const SILHOUETTE = [
	{ x: -9, y: -96 },
	{ x: 9, y: -96 },
	{ x: 73, y: -54 },
	{ x: 73, y: 96 },
	{ x: -73, y: 96 },
	{ x: -73, y: -54 },
];
const deg = (d: number) => (d * Math.PI) / 180;

function clearing(ring: PortalRing): { rx: number; ry: number } {
	const rx = ring.radius + OUTER_MARGIN;
	return { rx, ry: clearingRadiusYForRing(ring.radius, ring.angles, rx) };
}

function inside(
	x: number,
	y: number,
	rx: number,
	ry: number,
	margin: number,
): boolean {
	return (x / rx) ** 2 + ((Math.abs(y) + margin) / ry) ** 2 <= 1 + 1e-9;
}

const PATH_SETS: number[][] = [
	[],
	[deg(90)],
	[deg(-90)],
	[deg(0), deg(180)],
	[deg(-60), deg(30), deg(150)],
	[deg(10), deg(20), deg(30)],
];

describe("clearing fit for engine portal rings", () => {
	it("fits the footprint to the 2x arch the engine draws", () => {
		const ys = WORLD_ARCH_FOOTPRINT.map((p) => p.y);
		expect(Math.min(...ys)).toBe(-HALF_ARCH);
		expect(Math.max(...ys)).toBe(HALF_ARCH);
	});

	it("puts every ring slot's arch (roof to base) inside the clearing for rings of 1..40", () => {
		for (const paths of PATH_SETS)
			for (let count = 1; count <= 40; count++) {
				const ring = layoutPortalRing(count, paths, SIZES);
				const { rx, ry } = clearing(ring);
				expect(ry).toBeLessThanOrEqual(
					rx + CLEARING_HEIGHT_OVERSHOOT_PX + 1e-6,
				);
				for (const a of ring.angles) {
					const cx = Math.cos(a) * ring.radius;
					const cy = Math.sin(a) * ring.radius;
					for (const p of WORLD_ARCH_FOOTPRINT)
						expect(
							inside(cx + p.x, cy + p.y, rx, ry, CLEARING_FIT_MARGIN_PX),
							`${count} arches, paths ${paths}, slot ${a}`,
						).toBe(true);
				}
			}
	});

	it("keeps a top or bottom arch's whole silhouette, pillars included, on the grass", () => {
		for (let count = 1; count <= 40; count++) {
			const ring = layoutPortalRing(count, [], SIZES);
			const { rx, ry } = clearing(ring);
			for (const a of ring.angles) {
				if (Math.abs(Math.cos(a)) > 1e-9) continue;
				for (const p of SILHOUETTE)
					expect(
						inside(
							Math.cos(a) * ring.radius + p.x,
							Math.sin(a) * ring.radius + p.y,
							rx,
							ry,
							0,
						),
						`${count} arches, slot ${a}`,
					).toBe(true);
			}
		}
	});

	it("leaves a ring that already fits exactly as it was", () => {
		const ring = layoutPortalRing(2, [deg(-90), deg(90)], SIZES);
		expect(ring.angles.map((a) => Math.abs(Math.sin(a)))).toEqual([
			expect.closeTo(0, 9),
			expect.closeTo(0, 9),
		]);
		const { rx, ry } = clearing(ring);
		expect(ry).toBe(rx * GROUND_RADIUS_Y_RATIO);
	});

	it("grows the smallest ring's clearing from 175px to the top arch's roof plus the margin", () => {
		const ring = layoutPortalRing(1, [], SIZES);
		const { rx, ry } = clearing(ring);
		expect(rx * GROUND_RADIUS_Y_RATIO).toBeCloseTo(175.5, 6);
		expect(ry).toBeCloseTo(180 + HALF_ARCH + CLEARING_FIT_MARGIN_PX, 6);
	});
});
