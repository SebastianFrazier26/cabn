import { describe, expect, test } from "vitest";
import { themeFromSeed } from "../src/systems/theme.js";

describe("themeFromSeed", () => {
	test("is a pure function: same seed yields the same theme every time", () => {
		expect(themeFromSeed(12345)).toEqual(themeFromSeed(12345));
	});

	test("different seeds produce different tints", () => {
		const a = themeFromSeed(1);
		const b = themeFromSeed(2);
		expect(a.tint).not.toBe(b.tint);
	});

	test("clamps saturation and lightness to the tasteful band for a spread of seeds", () => {
		for (const seed of [0, 1, 42, 999999, 2 ** 31, 2 ** 32 - 1, -7, 3.7]) {
			const theme = themeFromSeed(seed);
			expect(theme.hue).toBeGreaterThanOrEqual(0);
			expect(theme.hue).toBeLessThan(360);
			expect(theme.saturation).toBeGreaterThanOrEqual(0.22);
			expect(theme.saturation).toBeLessThanOrEqual(0.4);
			expect(theme.lightness).toBeGreaterThanOrEqual(0.42);
			expect(theme.lightness).toBeLessThanOrEqual(0.58);
			expect(theme.tint).toBeGreaterThanOrEqual(0);
			expect(theme.tint).toBeLessThanOrEqual(0xffffff);
		}
	});

	test("negative and fractional seeds don't produce NaN", () => {
		const theme = themeFromSeed(-12345.6789);
		expect(Number.isNaN(theme.tint)).toBe(false);
		expect(Number.isInteger(theme.tint)).toBe(true);
	});

	test("seed 0 is a valid, non-crashing input", () => {
		expect(() => themeFromSeed(0)).not.toThrow();
	});
});
