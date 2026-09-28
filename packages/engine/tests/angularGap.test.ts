import { describe, expect, it } from "vitest";
import { largestAngularGapMidpoint } from "../src/systems/angularGap.js";

describe("largestAngularGapMidpoint", () => {
	it("returns 0 for no angles", () => {
		expect(largestAngularGapMidpoint([])).toBe(0);
	});

	it("points to the opposite side of a single angle", () => {
		const result = largestAngularGapMidpoint([0]);
		expect(result).toBeCloseTo(Math.PI);
	});

	it("finds the midpoint of a lopsided gap between two angles", () => {
		// Angles at 0 and PI/2 (a quarter turn apart) leave one small gap
		// (0 -> PI/2, size PI/2) and one large gap (PI/2 -> 2*PI, size 1.5*PI)
		// — the large one wins, with midpoint PI/2 + 1.5*PI/2 = 1.25*PI.
		const result = largestAngularGapMidpoint([0, Math.PI / 2]);
		expect(result).toBeCloseTo(1.25 * Math.PI, 5);
	});

	it("is not affected by input order", () => {
		const a = largestAngularGapMidpoint([0, Math.PI / 2, Math.PI]);
		const b = largestAngularGapMidpoint([Math.PI, 0, Math.PI / 2]);
		expect(b).toBeCloseTo(a, 5);
	});

	it("normalizes negative and >2*PI angles the same as their canonical form", () => {
		const a = largestAngularGapMidpoint([0, Math.PI]);
		const b = largestAngularGapMidpoint([-Math.PI * 2, Math.PI * 3]);
		expect(b).toBeCloseTo(a, 5);
	});
});
