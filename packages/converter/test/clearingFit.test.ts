import { describe, expect, it } from "vitest";
import {
	CLEARING_FIT_MARGIN_PX,
	clearingRadiusYForRing,
	GROUND_RADIUS_Y_RATIO,
	WORLD_ARCH_FOOTPRINT,
	worstCaseClearingRadiusY,
} from "../src/clearingFit.js";
import {
	CLEARING_GAP_PX,
	CLEARING_HEIGHT_OVERSHOOT_PX,
	estimatedClearingRadius,
	portalRingBaseRadius,
} from "../src/layout.js";

const deg = (d: number) => (d * Math.PI) / 180;

function insideEllipse(
	x: number,
	y: number,
	rx: number,
	ry: number,
	margin: number,
): boolean {
	return (x / rx) ** 2 + ((Math.abs(y) + margin) / ry) ** 2 <= 1 + 1e-9;
}

describe("clearingRadiusYForRing", () => {
	it("keeps today's 0.65 height when there are no arches", () => {
		expect(clearingRadiusYForRing(180, [], 270)).toBe(
			270 * GROUND_RADIUS_Y_RATIO,
		);
	});

	it("keeps today's height when every arch already fits (arches on the horizontal)", () => {
		expect(clearingRadiusYForRing(180, [0, Math.PI], 270)).toBe(
			270 * GROUND_RADIUS_Y_RATIO,
		);
	});

	it("grows a top arch's clearing to its roof plus the margin", () => {
		expect(clearingRadiusYForRing(180, [deg(-90)], 270)).toBeCloseTo(
			180 + 96 + CLEARING_FIT_MARGIN_PX,
			9,
		);
	});

	it("puts every footprint point of every arch inside the ellipse, with the margin", () => {
		for (const ringRadius of [180, 240, 413, 900]) {
			const rx = ringRadius + 90;
			const angles = Array.from({ length: 37 }, (_, i) => deg(i * 10 + 3));
			const ry = clearingRadiusYForRing(ringRadius, angles, rx);
			for (const a of angles)
				for (const p of WORLD_ARCH_FOOTPRINT) {
					const x = Math.cos(a) * ringRadius + p.x;
					const y = Math.sin(a) * ringRadius + p.y;
					expect(
						insideEllipse(x, y, rx, ry, CLEARING_FIT_MARGIN_PX),
						`R=${ringRadius} at ${a}`,
					).toBe(true);
				}
		}
	});

	it("refuses a footprint no height can contain", () => {
		expect(() =>
			clearingRadiusYForRing(180, [0], 270, [{ x: 95, y: 0 }], 0),
		).toThrow(/no height/);
	});
});

describe("height overshoot the converter's layout absorbs", () => {
	it("never grows a clearing's height more than CLEARING_HEIGHT_OVERSHOOT_PX past its width", () => {
		let worst = Number.NEGATIVE_INFINITY;
		for (let portals = 1; portals <= 80; portals++)
			for (let paths = 0; paths <= 10; paths++) {
				const rx = estimatedClearingRadius(portals, paths);
				const ry = worstCaseClearingRadiusY(
					portalRingBaseRadius(portals, paths),
					rx,
				);
				worst = Math.max(worst, ry - rx);
			}
		expect(worst).toBeLessThanOrEqual(CLEARING_HEIGHT_OVERSHOOT_PX + 1e-6);
		expect(worst).toBeGreaterThan(CLEARING_HEIGHT_OVERSHOOT_PX - 1);
	});

	it("leaves two vertically stacked neighbours a visible gap", () => {
		expect(CLEARING_GAP_PX - 2 * CLEARING_HEIGHT_OVERSHOOT_PX).toBeGreaterThan(
			0,
		);
	});
});
