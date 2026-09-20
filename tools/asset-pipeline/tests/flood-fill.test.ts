import { describe, expect, test } from "vitest";
import { backgroundFloodFillMask } from "../src/flood-fill.js";
import type { Grid } from "../src/nearest-dominant.js";

// 4x4 grid: a solid-color background ring around a 2x2 content block.
// B B B B
// B C C B
// B C C B
// B B B B
function ringGrid(): Grid {
	const bg = { r: 0, g: 0, b: 0 };
	const content = { r: 200, g: 200, b: 200 };
	const width = 4;
	const height = 4;
	const cells = [];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isRing = x === 0 || x === width - 1 || y === 0 || y === height - 1;
			cells.push(isRing ? bg : content);
		}
	}
	return { width, height, cells };
}

describe("backgroundFloodFillMask", () => {
	test("marks the connected background ring, not the enclosed content", () => {
		const grid = ringGrid();
		const mask = backgroundFloodFillMask(grid, { r: 0, g: 0, b: 0 }, 10);

		const expected = [
			true,
			true,
			true,
			true,
			true,
			false,
			false,
			true,
			true,
			false,
			false,
			true,
			true,
			true,
			true,
			true,
		];
		expect(mask).toEqual(expected);
	});

	test("chains tolerance step-to-step, so a gradual gradient reaches further than the threshold alone would allow", () => {
		// 1x5 strip, varying only R: 0 -> 8 -> 16 -> 24 -> 100. Each step is
		// within the threshold (10) even though the total drift from the seed
		// (24) is not, and the final jump to 100 is too large to cross.
		const rValues = [0, 8, 16, 24, 100];
		const grid: Grid = {
			width: rValues.length,
			height: 1,
			cells: rValues.map((r) => ({ r, g: 0, b: 0 })),
		};

		const mask = backgroundFloodFillMask(grid, { r: 0, g: 0, b: 0 }, 10);

		expect(mask).toEqual([true, true, true, true, false]);
	});
});
