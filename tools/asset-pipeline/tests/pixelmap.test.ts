import { describe, expect, test } from "vitest";
import { type PixelMap, renderPixelMap } from "../src/pixelmap.js";

const palette = [
	{ r: 10, g: 20, b: 30 },
	{ r: 200, g: 210, b: 220 },
];

describe("renderPixelMap", () => {
	test("renders correct dimensions, palette colors, and transparency", () => {
		const map: PixelMap = {
			name: "test",
			width: 2,
			height: 2,
			legend: { A: 0, B: 1 },
			rows: ["A.", ".B"],
		};

		const image = renderPixelMap(map, palette);

		expect(image.width).toBe(2);
		expect(image.height).toBe(2);
		expect(image.data).toHaveLength(2 * 2 * 4);

		// (0,0) = 'A' -> palette[0], opaque
		expect([...image.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
		// (1,0) = '.' -> transparent
		expect([...image.data.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
		// (0,1) = '.' -> transparent
		expect([...image.data.subarray(8, 12)]).toEqual([0, 0, 0, 0]);
		// (1,1) = 'B' -> palette[1], opaque
		expect([...image.data.subarray(12, 16)]).toEqual([200, 210, 220, 255]);
	});

	test("throws on a row with the wrong length", () => {
		const map: PixelMap = {
			name: "bad",
			width: 3,
			height: 1,
			legend: {},
			rows: [".."],
		};
		expect(() => renderPixelMap(map, palette)).toThrow(/row 0/);
	});

	test("throws on an unknown legend character", () => {
		const map: PixelMap = {
			name: "bad",
			width: 1,
			height: 1,
			legend: {},
			rows: ["Z"],
		};
		expect(() => renderPixelMap(map, palette)).toThrow(/legend/);
	});
});
