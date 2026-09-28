import { describe, expect, it } from "vitest";
import {
	clampGlowParams,
	DAY_GLOW_PARAMS,
	DEFAULT_GLOW_PARAMS,
	lerpGlowParams,
	NIGHT_GLOW_PARAMS,
} from "../../src/fx/glowParams.js";

describe("day/night glow presets", () => {
	it("leave tint/brightness neutral so glow-on and glow-off nights match (the grade lives in render/atmosphere.ts)", () => {
		for (const preset of [DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS]) {
			expect(preset.tint).toEqual({ r: 1, g: 1, b: 1 });
			expect(preset.brightness).toBe(1);
		}
	});

	it("lower the bloom threshold at night so lights bloom", () => {
		expect(NIGHT_GLOW_PARAMS.threshold).toBeLessThan(DAY_GLOW_PARAMS.threshold);
	});
});

describe("lerpGlowParams", () => {
	it("returns each endpoint at t=0 and t=1", () => {
		expect(lerpGlowParams(DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS, 0)).toEqual(
			DAY_GLOW_PARAMS,
		);
		const atOne = lerpGlowParams(DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS, 1);
		expect(atOne.threshold).toBeCloseTo(NIGHT_GLOW_PARAMS.threshold);
		expect(atOne.bloomIntensity).toBeCloseTo(NIGHT_GLOW_PARAMS.bloomIntensity);
	});

	it("is the field-wise midpoint at t=0.5", () => {
		const mid = lerpGlowParams(DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS, 0.5);
		expect(mid.threshold).toBeCloseTo(
			(DAY_GLOW_PARAMS.threshold + NIGHT_GLOW_PARAMS.threshold) / 2,
		);
	});
});

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

	it("clamps each tint channel to [0, 2] independently", () => {
		const result = clampGlowParams({ tint: { r: 5, g: -1, b: 1.2 } });
		expect(result.tint).toEqual({ r: 2, g: 0, b: 1.2 });
	});

	it("clamps brightness to [0.2, 1.5]", () => {
		expect(clampGlowParams({ brightness: 0 }).brightness).toBe(0.2);
		expect(clampGlowParams({ brightness: 10 }).brightness).toBe(1.5);
	});
});
