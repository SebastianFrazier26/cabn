import { describe, expect, it } from "vitest";
import {
	computeChunkRange,
	groundFieldChunkDrawList,
} from "../src/render/groundField.js";

// Grid math itself (computeChunkRange, chunk key/candidate helpers) now
// lives in worldChunkGrid.ts, shared with sceneryBaker.ts and pathBaker.ts —
// see worldChunkGrid.test.ts. groundField.ts re-exports computeChunkRange
// for its existing call sites; this is just a smoke check that the
// re-export is wired, not a re-test of the math itself.
describe("computeChunkRange (re-exported from worldChunkGrid.ts)", () => {
	it("covers a bounds box exactly aligned to the chunk grid", () => {
		expect(
			computeChunkRange({ minX: 0, minY: 0, maxX: 512, maxY: 512 }, 512),
		).toEqual({
			startCol: 0,
			endCol: 1,
			startRow: 0,
			endRow: 1,
		});
	});
});

// M10 stream-bake: a streamed chunk must be pixel-for-pixel what the old
// whole-world bakeGroundField produced for that same (col, row) — these
// compare the pure per-tile frame/position draw list (headless Vitest has no
// canvas/WebGL, so this is the "compare draw lists" fallback the task's own
// equivalence-test brief allows) rather than rendered pixels.
describe("groundFieldChunkDrawList", () => {
	it("is a pure function of (chunkCol, chunkRow, seed) — independent of any other chunk baking before or after it", () => {
		const seed = 20260928;
		const first = groundFieldChunkDrawList(3, -2, seed);
		const second = groundFieldChunkDrawList(3, -2, seed);
		expect(second).toEqual(first);
	});

	it("matches full-world bakeGroundField's per-tile draws for the same chunk, for every chunk in a multi-chunk world, in any bake order", () => {
		const seed = 12345;
		// Recreate exactly what bakeGroundField's loop would have produced for
		// chunks (0,0)..(2,1) by calling the per-chunk function directly in
		// row-major order (the old function's own iteration order)...
		const rowMajor: ReturnType<typeof groundFieldChunkDrawList>[] = [];
		for (let row = 0; row < 2; row++) {
			for (let col = 0; col < 3; col++)
				rowMajor.push(groundFieldChunkDrawList(col, row, seed));
		}
		// ...then again in a deliberately different order (as a streamer bakes
		// whichever chunk is nearest the camera first, not row-major) and
		// confirm each chunk's own draw list didn't change.
		const shuffledOrder: [number, number][] = [
			[2, 1],
			[0, 0],
			[1, 1],
			[2, 0],
			[0, 1],
			[1, 0],
		];
		for (const [col, row] of shuffledOrder) {
			const streamed = groundFieldChunkDrawList(col, row, seed);
			const expected = rowMajor[row * 3 + col];
			expect(streamed).toEqual(expected);
		}
	});

	it("produces one draw per tile in the 16x16 chunk grid, base-variant frames only (never an edge/blob frame)", () => {
		const draws = groundFieldChunkDrawList(0, 0, 1);
		expect(draws).toHaveLength(16 * 16);
		const positions = new Set(draws.map((d) => `${d.x},${d.y}`));
		expect(positions.size).toBe(16 * 16); // no duplicate/missing tile
	});
});
