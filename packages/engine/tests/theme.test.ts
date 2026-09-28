import { describe, expect, test } from "vitest";
import { subtleTint, themeFromSeed } from "../src/systems/theme.js";

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

describe("subtleTint", () => {
	test("strength 1 leaves the color untouched", () => {
		expect(subtleTint(0xff0000, 1)).toBe(0xff0000);
	});

	test("strength 0 mixes all the way to white", () => {
		expect(subtleTint(0xff0000, 0)).toBe(0xffffff);
	});

	test("an intermediate strength lands strictly between the color and white", () => {
		const result = subtleTint(0x000000, 0.5);
		const r = (result >> 16) & 0xff;
		expect(r).toBeGreaterThan(0);
		expect(r).toBeLessThan(255);
	});

	test("clamps strength outside [0, 1] rather than extrapolating", () => {
		expect(subtleTint(0xff0000, 2)).toBe(subtleTint(0xff0000, 1));
		expect(subtleTint(0xff0000, -1)).toBe(subtleTint(0xff0000, 0));
	});
});
