import { describe, expect, it } from "vitest";
import {
	DAY_GRADE_COLOR,
	DAY_NIGHT_CROSSFADE_MS,
	easeBlend,
	flickerAt,
	gradeColorAt,
	lerpColor,
	NIGHT_GRADE_COLOR,
	stepBlend,
	targetBlend,
} from "../src/systems/dayNight.js";

describe("targetBlend", () => {
	it("maps day to 0 and night to 1", () => {
		expect(targetBlend("day")).toBe(0);
		expect(targetBlend("night")).toBe(1);
	});
});

describe("stepBlend", () => {
	it("reaches the target in exactly the cross-fade duration, frame-rate independent", () => {
		let fast = 0;
		for (let i = 0; i < 60; i++) {
			fast = stepBlend(
				fast,
				1,
				DAY_NIGHT_CROSSFADE_MS / 60,
				DAY_NIGHT_CROSSFADE_MS,
				false,
			);
		}
		let slow = 0;
		for (let i = 0; i < 6; i++) {
			slow = stepBlend(
				slow,
				1,
				DAY_NIGHT_CROSSFADE_MS / 6,
				DAY_NIGHT_CROSSFADE_MS,
				false,
			);
		}
		expect(fast).toBeCloseTo(1, 10);
		expect(slow).toBeCloseTo(1, 10);
	});

	it("is halfway after half the duration", () => {
		expect(stepBlend(0, 1, 300, 600, false)).toBeCloseTo(0.5);
	});

	it("never overshoots in either direction", () => {
		expect(stepBlend(0.9, 1, 10_000, 600, false)).toBe(1);
		expect(stepBlend(0.1, 0, 10_000, 600, false)).toBe(0);
	});

	it("turns around mid-fade when the target flips", () => {
		const mid = stepBlend(0, 1, 300, 600, false);
		expect(stepBlend(mid, 0, 150, 600, false)).toBeCloseTo(0.25);
	});

	it("swaps instantly under reduced motion", () => {
		expect(stepBlend(0, 1, 16, 600, true)).toBe(1);
		expect(stepBlend(1, 0, 16, 600, true)).toBe(0);
	});

	it("ignores a negative delta rather than moving backward", () => {
		expect(stepBlend(0.5, 1, -100, 600, false)).toBe(0.5);
	});
});

describe("easeBlend", () => {
	it("pins the endpoints and the midpoint, clamping out-of-range input", () => {
		expect(easeBlend(0)).toBe(0);
		expect(easeBlend(1)).toBe(1);
		expect(easeBlend(0.5)).toBe(0.5);
		expect(easeBlend(-1)).toBe(0);
		expect(easeBlend(2)).toBe(1);
	});
});

describe("lerpColor / gradeColorAt", () => {
	it("interpolates per channel", () => {
		expect(lerpColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
		expect(lerpColor(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
	});

	it("is the day grade at 0 and the night grade at 1", () => {
		expect(gradeColorAt(0)).toBe(DAY_GRADE_COLOR);
		expect(gradeColorAt(1)).toBe(NIGHT_GRADE_COLOR);
	});

	it("keeps more blue than red or green at night (reads blue-violet, not dim green)", () => {
		const r = (NIGHT_GRADE_COLOR >> 16) & 0xff;
		const g = (NIGHT_GRADE_COLOR >> 8) & 0xff;
		const b = NIGHT_GRADE_COLOR & 0xff;
		expect(b).toBeGreaterThan(r * 1.8);
		expect(b).toBeGreaterThan(g * 1.8);
		expect(Math.max(r, g, b)).toBeLessThan(0xa0);
	});
});

describe("flickerAt", () => {
	it("stays within a gentle band", () => {
		for (let t = 0; t < 5000; t += 37) {
			const f = flickerAt(t, 1.3);
			expect(f).toBeGreaterThanOrEqual(0.8);
			expect(f).toBeLessThanOrEqual(1);
		}
	});

	it("is deterministic for a given time and phase", () => {
		expect(flickerAt(1234, 0.5)).toBe(flickerAt(1234, 0.5));
	});
});
