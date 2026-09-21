import { describe, expect, test } from "vitest";
import type { RawImage } from "../src/image-io.js";
import { soften } from "../src/soften.js";

function makeSource(): RawImage {
	// 3x3 grid: a bright cell, a mid cell, a transparent (background) cell.
	const width = 3;
	const height = 3;
	const data = Buffer.alloc(width * height * 4);
	const cells: [number, number, number, number][] = [
		[240, 240, 240, 255],
		[120, 80, 40, 255],
		[0, 0, 0, 0],
		[120, 80, 40, 255],
		[120, 80, 40, 255],
		[120, 80, 40, 255],
		[0, 0, 0, 0],
		[120, 80, 40, 255],
		[240, 240, 240, 255],
	];
	cells.forEach(([r, g, b, a], i) => {
		const p = i * 4;
		data[p] = r;
		data[p + 1] = g;
		data[p + 2] = b;
		data[p + 3] = a;
	});
	return { data, width, height };
}

describe("soften", () => {
	test("is deterministic: same input and options produce byte-identical output", () => {
		const source = makeSource();
		const a = soften(source, { cellSize: 4 });
		const b = soften(source, { cellSize: 4 });
		expect(a.width).toBe(b.width);
		expect(a.height).toBe(b.height);
		expect(a.data.equals(b.data)).toBe(true);
	});

	test("different seeds change the output", () => {
		const source = makeSource();
		const a = soften(source, { cellSize: 4, seed: 1 });
		const b = soften(source, { cellSize: 4, seed: 2 });
		expect(a.data.equals(b.data)).toBe(false);
	});

	test("upscales to width*cellSize by height*cellSize and keeps background transparent", () => {
		const source = makeSource();
		// Edge feathering is exercised separately in mask-feather.test.ts; disable
		// it here so this assertion is only about background cells staying inert.
		const result = soften(source, {
			cellSize: 4,
			edgeFeatherPx: 0,
			bloomStrength: 0,
		});
		expect(result.width).toBe(12);
		expect(result.height).toBe(12);

		// Cell (2,0) was fully transparent in the source; its whole 4x4 block
		// should still read alpha 0 after softening.
		for (let y = 0; y < 4; y++) {
			for (let x = 8; x < 12; x++) {
				const idx = (y * result.width + x) * 4 + 3;
				expect(result.data[idx]).toBe(0);
			}
		}
	});
});
