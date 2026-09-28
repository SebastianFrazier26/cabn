import { describe, expect, it } from "vitest";
import { phaseFromHour, resolveTimeOfDay } from "../src/systems/timeOfDay.js";

describe("phaseFromHour", () => {
	it("is night just before 6am", () => {
		expect(phaseFromHour(5)).toBe("night");
	});

	it("is day starting exactly at 6am", () => {
		expect(phaseFromHour(6)).toBe("day");
	});

	it("is day just before 6pm", () => {
		expect(phaseFromHour(17)).toBe("day");
	});

	it("is night starting exactly at 6pm", () => {
		expect(phaseFromHour(18)).toBe("night");
	});

	it("is night at midnight and late evening", () => {
		expect(phaseFromHour(0)).toBe("night");
		expect(phaseFromHour(23)).toBe("night");
	});
});

describe("resolveTimeOfDay", () => {
	it("delegates to the clock when override is auto", () => {
		expect(resolveTimeOfDay("auto", new Date(2026, 0, 1, 10))).toBe("day");
		expect(resolveTimeOfDay("auto", new Date(2026, 0, 1, 22))).toBe("night");
	});

	it("returns day regardless of the clock when overridden to day", () => {
		expect(resolveTimeOfDay("day", new Date(2026, 0, 1, 2))).toBe("day");
	});

	it("returns night regardless of the clock when overridden to night", () => {
		expect(resolveTimeOfDay("night", new Date(2026, 0, 1, 14))).toBe("night");
	});

	it("defaults `now` to the current time when not given", () => {
		// Just asserts it doesn't throw and returns a valid phase — the actual
		// value depends on when the test runs, which isn't this test's job.
		expect(["day", "night"]).toContain(resolveTimeOfDay("auto"));
	});
});
