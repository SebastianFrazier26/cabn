import { describe, expect, it } from "vitest";
import {
	clampGlowParams,
	DEFAULT_GLOW_PARAMS,
} from "../../src/fx/glowParams.js";

describe("clampGlowParams", () => {
	it("returns the defaults untouched when given no overrides", () => {
		expect(clampGlowParams({})).toEqual(DEFAULT_GLOW_PARAMS);
	});

	it("merges a partial override onto the defaults", () => {
		expect(clampGlowParams({ threshold: 0.5 })).toEqual({
			...DEFAULT_GLOW_PARAMS,
			threshold: 0.5,
		});
	});

	it("clamps threshold/bloomIntensity/vignetteStrength to [0, 1]", () => {
		const result = clampGlowParams({
			threshold: 5,
			bloomIntensity: -3,
			vignetteStrength: 2,
		});
		expect(result.threshold).toBe(1);
		expect(result.bloomIntensity).toBe(0);
		expect(result.vignetteStrength).toBe(1);
	});

	it("clamps blurRadius to [0, 8]", () => {
		expect(clampGlowParams({ blurRadius: -1 }).blurRadius).toBe(0);
		expect(clampGlowParams({ blurRadius: 100 }).blurRadius).toBe(8);
	});

	it("clamps vignetteRadius to [0.1, 1]", () => {
		expect(clampGlowParams({ vignetteRadius: 0 }).vignetteRadius).toBe(0.1);
		expect(clampGlowParams({ vignetteRadius: 3 }).vignetteRadius).toBe(1);
	});

	it("treats NaN as the field's minimum rather than propagating NaN", () => {
		expect(clampGlowParams({ threshold: Number.NaN }).threshold).toBe(0);
	});
});
