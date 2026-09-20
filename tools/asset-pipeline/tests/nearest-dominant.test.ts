import { describe, expect, test } from "vitest";
import type { RGB } from "../src/color.js";
import { dominantDownscale } from "../src/nearest-dominant.js";

// Builds a 4x4 RGBA buffer split into four 2x2 quadrants, each quadrant
// mostly one color with a single "noise" pixel that must lose the vote.
function buildQuadrantImage(colors: [RGB, RGB, RGB, RGB]): {
	data: Buffer;
	width: number;
	height: number;
} {
	const width = 4;
	const height = 4;
	const data = Buffer.alloc(width * height * 4);
	const pixelColor = (x: number, y: number): RGB => {
		const quadrant = (x < 2 ? 0 : 1) + (y < 2 ? 0 : 2);
		const isNoisePixel =
			x === (quadrant % 2 === 0 ? 1 : 2) && y === (quadrant < 2 ? 1 : 2);
		return isNoisePixel ? { r: 0, g: 0, b: 0 } : colors[quadrant];
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const { r, g, b } = pixelColor(x, y);
			const i = (y * width + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

describe("dominantDownscale", () => {
	test("picks the modal color per cell, not the average", () => {
		const quadrants: [RGB, RGB, RGB, RGB] = [
			{ r: 255, g: 0, b: 0 },
			{ r: 0, g: 255, b: 0 },
			{ r: 0, g: 0, b: 255 },
			{ r: 255, g: 255, b: 0 },
		];
		const image = buildQuadrantImage(quadrants);

		const grid = dominantDownscale(
			image,
			{ x: 0, y: 0, width: 4, height: 4 },
			2,
		);

		expect(grid.width).toBe(2);
		expect(grid.height).toBe(2);
		expect(grid.cells).toEqual(quadrants);
	});
});
