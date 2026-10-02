import { describe, expect, test } from "vitest";
import { reducePeaks, waveformBars } from "../src/systems/waveform.js";

describe("reducePeaks", () => {
	test("takes the loudest absolute sample per bucket and normalizes to 1", () => {
		const samples = [0.1, -0.2, 0.05, 0.4, -0.1, 0.0, -0.8, 0.2];
		expect(reducePeaks([samples], 4)).toEqual([0.25, 0.5, 0.125, 1]);
	});

	test("merges channels by the louder one", () => {
		const left = [0.5, 0, 0, 0];
		const right = [0, 0, 0, -0.25];
		expect(reducePeaks([left, right], 2)).toEqual([1, 0.5]);
	});

	test("silence stays zero, empty input and zero buckets are handled", () => {
		expect(reducePeaks([[0, 0, 0, 0]], 2)).toEqual([0, 0]);
		expect(reducePeaks([], 3)).toEqual([0, 0, 0]);
		expect(reducePeaks([[1, 2]], 0)).toEqual([]);
	});

	test("more buckets than samples repeats samples instead of leaving gaps", () => {
		const peaks = reducePeaks([[0.5, 1]], 4);
		expect(peaks).toHaveLength(4);
		expect(peaks.every((p) => p > 0)).toBe(true);
	});

	test("works on a long buffer without exceeding 1", () => {
		const buf = new Float32Array(48_000).map((_, i) => Math.sin(i / 50) * 0.3);
		const peaks = reducePeaks([buf], 240);
		expect(peaks).toHaveLength(240);
		expect(Math.max(...peaks)).toBeCloseTo(1, 5);
		expect(Math.min(...peaks)).toBeGreaterThan(0.9);
	});
});

describe("waveformBars", () => {
	const box = { x: 0, y: 0, w: 100, h: 40 };

	test("fits as many bars as the pitch allows, centred vertically", () => {
		const bars = waveformBars([1, 0.5], box, 3, 2);
		expect(bars).toHaveLength(20);
		const first = bars[0];
		expect(first?.h).toBe(40);
		expect(first?.y).toBe(0);
		const last = bars[bars.length - 1];
		expect(last?.h).toBe(20);
		expect(last?.y).toBe(10);
		expect((last?.x ?? 0) + (last?.w ?? 0)).toBeLessThanOrEqual(100);
	});

	test("silent bars are still 1px lines", () => {
		expect(waveformBars([0], box, 3, 2).every((b) => b.h === 1)).toBe(true);
	});

	test("progress marks the played prefix", () => {
		const bars = waveformBars(
			[1, 1, 1, 1],
			{ x: 0, y: 0, w: 40, h: 10 },
			8,
			2,
			0.5,
		);
		expect(bars.map((b) => b.played)).toEqual([true, true, false, false]);
	});

	test("degenerate inputs produce no bars", () => {
		expect(waveformBars([], box, 3, 2)).toEqual([]);
		expect(waveformBars([1], { ...box, w: 0 }, 3, 2)).toEqual([]);
	});
});
