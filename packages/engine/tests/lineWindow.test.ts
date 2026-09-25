import { describe, expect, it } from "vitest";
import {
	computeLineWindow,
	lineWindowsEqual,
} from "../src/systems/lineWindow.js";

describe("computeLineWindow", () => {
	it("returns an empty window for an empty file", () => {
		expect(computeLineWindow(0, 600, 18, 0, 10)).toEqual({ start: 0, end: 0 });
	});

	it("windows a small file entirely within the buffer as [0, totalLines)", () => {
		const win = computeLineWindow(0, 600, 18, 20, 15);
		expect(win.start).toBe(0);
		expect(win.end).toBe(20);
	});

	it("never creates a window anywhere near the size of a huge file", () => {
		const win = computeLineWindow(50000, 600, 18, 5000, 15);
		expect(win.end - win.start).toBeLessThan(100);
	});

	it("clamps the start at 0 near the top of the file", () => {
		const win = computeLineWindow(0, 600, 18, 5000, 15);
		expect(win.start).toBe(0);
	});

	it("clamps the end at totalLines near the bottom of the file", () => {
		const win = computeLineWindow(5000 * 18, 600, 18, 5000, 15);
		expect(win.end).toBe(5000);
	});

	it("clamps a negative scrollY (above the file, near the exit portal) to start 0", () => {
		const win = computeLineWindow(-500, 600, 18, 100, 15);
		expect(win.start).toBe(0);
	});

	it("still produces a valid (possibly empty) window with zero buffer", () => {
		const win = computeLineWindow(0, 100, 18, 1000, 0);
		expect(win.start).toBe(0);
		expect(win.end).toBeGreaterThan(0);
		expect(win.end).toBeLessThanOrEqual(1000);
	});

	it("moves the window down as scrollY increases", () => {
		const near = computeLineWindow(0, 600, 18, 5000, 15);
		const far = computeLineWindow(3600, 600, 18, 5000, 15);
		expect(far.start).toBeGreaterThan(near.start);
	});
});

describe("lineWindowsEqual", () => {
	it("is true for identical windows", () => {
		expect(lineWindowsEqual({ start: 1, end: 5 }, { start: 1, end: 5 })).toBe(
			true,
		);
	});

	it("is false when either bound differs", () => {
		expect(lineWindowsEqual({ start: 1, end: 5 }, { start: 2, end: 5 })).toBe(
			false,
		);
		expect(lineWindowsEqual({ start: 1, end: 5 }, { start: 1, end: 6 })).toBe(
			false,
		);
	});
});
