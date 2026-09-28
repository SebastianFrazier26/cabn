import { describe, expect, it } from "vitest";
import { loadTimeOfDayOverride } from "../src/systems/timeOfDaySettings.js";

// A thin try/catch localStorage shell, deliberately untested against a real
// localStorage (Vitest's default node environment has none at all).
describe("loadTimeOfDayOverride", () => {
	it("returns null when localStorage isn't available at all", () => {
		expect(loadTimeOfDayOverride()).toBeNull();
	});
});
