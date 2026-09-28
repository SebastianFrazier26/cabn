import { describe, expect, it } from "vitest";
import {
	defaultGlowEnabled,
	loadGlowEnabled,
} from "../../src/systems/glowSettings.js";

describe("defaultGlowEnabled", () => {
	it("is on by default", () => {
		expect(defaultGlowEnabled(false)).toBe(true);
	});

	it("is off when the platform prefers reduced motion", () => {
		expect(defaultGlowEnabled(true)).toBe(false);
	});
});

// loadGlowEnabled/persistGlowEnabled are a thin try/catch localStorage shell,
// same as save.ts's own adapter — deliberately untested against a real
// localStorage here (Vitest's default node environment has no such global at
// all, not just a throwing one); this only covers the no-global branch.
describe("loadGlowEnabled", () => {
	it("returns null when localStorage isn't available at all", () => {
		expect(loadGlowEnabled()).toBeNull();
	});
});
