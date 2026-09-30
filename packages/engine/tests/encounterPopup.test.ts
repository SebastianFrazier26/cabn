import { describe, expect, it } from "vitest";
import {
	keyDismissal,
	shouldContinueEncounter,
} from "../src/systems/encounterPopup.js";

describe("keyDismissal", () => {
	const base = { key: "a", modifierHeld: false, repeat: false };

	it("closes without continuing on Escape", () => {
		expect(keyDismissal({ ...base, key: "Escape" })).toBe("close");
	});

	it("continues on Enter, Space, or any other plain key", () => {
		expect(keyDismissal({ ...base, key: "Enter" })).toBe("continue");
		expect(keyDismissal({ ...base, key: " " })).toBe("continue");
		expect(keyDismissal({ ...base, key: "q" })).toBe("continue");
		expect(keyDismissal({ ...base, key: "ArrowDown" })).toBe("continue");
	});

	it("lets a held modifier chord through untouched, even Escape", () => {
		expect(keyDismissal({ ...base, key: "r", modifierHeld: true })).toBeNull();
		expect(
			keyDismissal({ ...base, key: "Escape", modifierHeld: true }),
		).toBeNull();
	});

	it("ignores a held-key repeat instead of re-firing continue", () => {
		expect(keyDismissal({ ...base, key: "Enter", repeat: true })).toBeNull();
	});

	it("still closes on a repeated Escape (holding it down shouldn't get stuck open)", () => {
		expect(keyDismissal({ ...base, key: "Escape", repeat: true })).toBe(
			"close",
		);
	});
});

describe("shouldContinueEncounter", () => {
	const base = {
		mode: "encounter",
		activeMonsterId: "monster:1",
		dismissedMonsterId: "monster:1",
		monsterStillPresent: true,
	};

	it("continues when the dismissed monster is still the active encounter", () => {
		expect(shouldContinueEncounter(base)).toBe(true);
	});

	it("refuses once the encounter has already ended", () => {
		expect(shouldContinueEncounter({ ...base, mode: "file" })).toBe(false);
	});

	it("refuses a stale dismissal for a since-superseded encounter", () => {
		expect(
			shouldContinueEncounter({ ...base, activeMonsterId: "monster:2" }),
		).toBe(false);
	});

	it("refuses when the monster was defeated (e.g. by a save) while the popup was up", () => {
		expect(
			shouldContinueEncounter({ ...base, monsterStillPresent: false }),
		).toBe(false);
	});
});
