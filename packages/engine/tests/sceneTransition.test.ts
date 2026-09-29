import { describe, expect, it } from "vitest";
import {
	cabinTransitionDelayMs,
	cabinTransitionTotalMs,
	encounterIntroTotalMs,
	layerRiseMs,
	layerTransitionDelayMs,
	layerTransitionTotalMs,
	portalTransitionTotalMs,
	sceneTransitionTotalMs,
} from "../src/systems/sceneTransition.js";

// The brief's own hard constraint: "Each transition must be quick (under
// 700ms)" — asserted directly rather than trusting the individual constants
// never drift past it as they get tuned.
const MAX_TRANSITION_MS = 700;

describe("cabin transition timing", () => {
	it("stays under the 700ms budget, full motion", () => {
		expect(cabinTransitionTotalMs(false)).toBeLessThan(MAX_TRANSITION_MS);
	});

	it("is shorter under reduced motion than full motion", () => {
		expect(cabinTransitionTotalMs(true)).toBeLessThan(
			cabinTransitionTotalMs(false),
		);
	});

	it("delays the scene.start cut by less than the fade's own total duration", () => {
		expect(cabinTransitionDelayMs(false)).toBeLessThan(
			cabinTransitionTotalMs(false),
		);
		expect(cabinTransitionDelayMs(true)).toBeLessThan(
			cabinTransitionTotalMs(true),
		);
	});
});

describe("encounter intro timing", () => {
	it("stays under the 700ms budget, full motion", () => {
		expect(encounterIntroTotalMs(false)).toBeLessThan(MAX_TRANSITION_MS);
	});

	it("is shorter under reduced motion than full motion", () => {
		expect(encounterIntroTotalMs(true)).toBeLessThan(
			encounterIntroTotalMs(false),
		);
	});
});

describe("portal transition timing", () => {
	it("stays under the 700ms budget, full motion", () => {
		expect(portalTransitionTotalMs(false)).toBeLessThan(MAX_TRANSITION_MS);
	});

	it("is shorter under reduced motion than full motion", () => {
		expect(portalTransitionTotalMs(true)).toBeLessThan(
			portalTransitionTotalMs(false),
		);
	});
});

describe("sceneTransitionTotalMs", () => {
	it("dispatches to the same per-kind total the dedicated helpers return", () => {
		expect(sceneTransitionTotalMs("cabin", false)).toBe(
			cabinTransitionTotalMs(false),
		);
		expect(sceneTransitionTotalMs("encounter", true)).toBe(
			encounterIntroTotalMs(true),
		);
		expect(sceneTransitionTotalMs("portal", false)).toBe(
			portalTransitionTotalMs(false),
		);
	});
});

describe("layer transition timing", () => {
	it("stays under the 700ms budget and cuts while the pulse peaks", () => {
		expect(layerTransitionTotalMs(false)).toBeLessThanOrEqual(
			MAX_TRANSITION_MS,
		);
		expect(layerTransitionDelayMs(false)).toBeLessThan(
			layerTransitionTotalMs(false),
		);
		expect(sceneTransitionTotalMs("layer", false)).toBe(
			layerTransitionTotalMs(false),
		);
	});
	it("collapses to the flat fade, with no rise, under reduced motion", () => {
		expect(layerTransitionTotalMs(true)).toBe(cabinTransitionTotalMs(true));
		expect(layerRiseMs(true)).toBe(0);
		expect(layerRiseMs(false)).toBeGreaterThan(0);
	});
});
