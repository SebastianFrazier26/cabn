import { describe, expect, test } from "vitest";
import { cylinderBand, sphereBand } from "../src/pixelmaps/ui-icon-shading.js";

describe("cylinderBand", () => {
	test("the light side (negative perp) is brighter than the shadow side", () => {
		expect(cylinderBand(-1, 1)).toBeGreaterThan(cylinderBand(1, 1));
	});

	test("is scale-invariant (only the perp/radius ratio matters)", () => {
		expect(cylinderBand(-2, 4)).toBe(cylinderBand(-1, 2));
	});

	test("returns one of the four defined bands across the full range", () => {
		const bands = new Set([-1, -0.5, 0, 0.5, 1].map((t) => cylinderBand(t, 1)));
		for (const b of bands) expect([0, 1, 2, 3]).toContain(b);
	});
});

describe("sphereBand", () => {
	test("facing the light (dot near 1) is brighter than facing away (dot near -1)", () => {
		expect(sphereBand(0.9)).toBeGreaterThan(sphereBand(-0.9));
	});

	test("is monotonic in the dot product", () => {
		const dots = [-1, -0.6, -0.2, 0.2, 0.6, 1];
		const bands = dots.map(sphereBand);
		for (let i = 1; i < bands.length; i++) {
			expect(bands[i]).toBeGreaterThanOrEqual(bands[i - 1] as number);
		}
	});
});
