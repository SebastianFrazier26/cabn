import { describe, expect, it } from "vitest";
import { prefersReducedMotion } from "../src/systems/reducedMotion.js";

describe("prefersReducedMotion", () => {
	it("reports no preference without a window (node, SSR)", () => {
		expect(prefersReducedMotion()).toBe(false);
	});
});
