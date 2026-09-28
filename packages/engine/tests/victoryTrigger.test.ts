import { describe, expect, it } from "vitest";
import { shouldShowVictoryToast } from "../src/systems/victoryTrigger.js";

describe("shouldShowVictoryToast", () => {
	it("fires exactly on the >0 -> 0 transition", () => {
		expect(shouldShowVictoryToast(1, 0, true)).toBe(true);
		expect(shouldShowVictoryToast(3, 0, true)).toBe(true);
	});

	it("does not fire while bugs remain", () => {
		expect(shouldShowVictoryToast(3, 1, true)).toBe(false);
	});

	it("does not fire on first observation, even if already at zero (a revisited, already-cleared world)", () => {
		expect(shouldShowVictoryToast(null, 0, true)).toBe(false);
	});

	it("does not fire again once already at zero (no re-trigger on a steady 0 -> 0 render)", () => {
		expect(shouldShowVictoryToast(0, 0, true)).toBe(false);
	});

	it("never fires for a world that never had any monsters", () => {
		expect(shouldShowVictoryToast(0, 0, false)).toBe(false);
		expect(shouldShowVictoryToast(1, 0, false)).toBe(false);
	});
});
