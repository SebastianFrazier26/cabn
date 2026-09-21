import { describe, expect, test } from "vitest";
import { featherMask, placeMaskInCanvas } from "../src/mask-feather.js";

describe("placeMaskInCanvas", () => {
	test("upscales a grid mask into the box and leaves everything outside it as background", () => {
		// 2x2 grid: `backgroundMask` true means "this cell is background".
		// Left column is content, right column is background.
		const backgroundMask = [false, true, false, true];
		const canvas = placeMaskInCanvas(
			backgroundMask,
			2,
			{ x: 2, y: 2, width: 4, height: 4 },
			8,
		);

		expect(canvas).toHaveLength(64);
		// Outside the box entirely: background.
		expect(canvas[0]).toBe(0);
		expect(canvas[8 * 7 + 7]).toBe(0);
		// Inside the box, left half of each grid row -> content (mask[0]=false).
		expect(canvas[3 * 8 + 3]).toBe(255);
		// Inside the box, right half -> background (mask[1]=true).
		expect(canvas[3 * 8 + 5]).toBe(0);
	});
});

describe("featherMask", () => {
	test("leaves values far from any edge unchanged", () => {
		const width = 20;
		const height = 20;
		const mask = new Uint8Array(width * height);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) mask[y * width + x] = x < 10 ? 0 : 255;

		const feathered = featherMask(mask, width, height, 2);
		// Far from the x=10 edge, values should stay at their extremes.
		expect(feathered[10 * width + 1]).toBe(0);
		expect(feathered[10 * width + 18]).toBe(255);
	});

	test("produces an intermediate value right at the edge", () => {
		const width = 20;
		const height = 20;
		const mask = new Uint8Array(width * height);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) mask[y * width + x] = x < 10 ? 0 : 255;

		const feathered = featherMask(mask, width, height, 2);
		const atEdge = feathered[10 * width + 10] ?? -1;
		expect(atEdge).toBeGreaterThan(0);
		expect(atEdge).toBeLessThan(255);
	});
});
