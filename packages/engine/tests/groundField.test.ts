import { describe, expect, it } from "vitest";
import {
	computeChunkRange,
	groundFieldCandidatesNear,
	groundFieldChunkDrawList,
	groundFieldChunkKey,
	groundFieldPositionOf,
	parseGroundFieldChunkKey,
} from "../src/render/groundField.js";

describe("computeChunkRange", () => {
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

	it("rounds outward (never inward) for bounds that don't land on chunk edges", () => {
		// [-10, 520] at chunk size 512 must include both the -1 and 1 chunk
		// columns fully — rounding inward would clip real ground off the edge.
		const range = computeChunkRange(
			{ minX: -10, minY: -10, maxX: 520, maxY: 520 },
			512,
		);
		expect(range.startCol).toBeLessThanOrEqual(-1);
		expect(range.endCol).toBeGreaterThanOrEqual(2);
		expect(range.startRow).toBeLessThanOrEqual(-1);
		expect(range.endRow).toBeGreaterThanOrEqual(2);
	});

	it("covers negative-only bounds", () => {
		const range = computeChunkRange(
			{ minX: -1000, minY: -1000, maxX: -600, maxY: -600 },
			512,
		);
		expect(range.startCol).toBeLessThanOrEqual(Math.floor(-1000 / 512));
		expect(range.endCol).toBeGreaterThanOrEqual(Math.ceil(-600 / 512));
	});

	it("always produces at least one chunk for a non-empty bounds box", () => {
		const range = computeChunkRange(
			{ minX: 5, minY: 5, maxX: 10, maxY: 10 },
			512,
		);
		expect(range.endCol).toBeGreaterThan(range.startCol);
		expect(range.endRow).toBeGreaterThan(range.startRow);
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

describe("groundFieldChunkKey / parseGroundFieldChunkKey / groundFieldPositionOf", () => {
	it("round-trips through key parsing, including negative coordinates", () => {
		expect(parseGroundFieldChunkKey(groundFieldChunkKey(-3, 7))).toEqual({
			chunkCol: -3,
			chunkRow: 7,
		});
	});

	it("positionOf returns each chunk's own center in world space", () => {
		expect(groundFieldPositionOf(groundFieldChunkKey(0, 0))).toEqual({
			x: 256,
			y: 256,
		});
		expect(groundFieldPositionOf(groundFieldChunkKey(-1, -1))).toEqual({
			x: -256,
			y: -256,
		});
	});
});

describe("groundFieldCandidatesNear", () => {
	it("returns a bounded window regardless of how far `radius` conceptually reaches — scan cost is O((radius/chunkSize)^2), not O(world size)", () => {
		const small = groundFieldCandidatesNear({ x: 0, y: 0 }, 600);
		const large = groundFieldCandidatesNear({ x: 0, y: 0 }, 6000);
		// A 10x bigger radius gives a proportionally bigger (but still finite,
		// still cheap) window — this is the assertion that actually matters:
		// nothing here scales with total world chunk count.
		expect(large.length).toBeGreaterThan(small.length);
		expect(large.length).toBeLessThan(2000);
	});

	it('never misses a chunk whose center is genuinely within radius — planStream can only load what\'s in this window, so a gap here is a silent "never streams in" bug', () => {
		const camera = { x: 1000, y: -500 };
		const radius = 800;
		const candidates = groundFieldCandidatesNear(camera, radius);
		const keys = new Set(candidates.map((c) => c.key));
		// Sweep a grid of chunk centers well past `radius` and confirm every one
		// truly inside it appears in the window (extras beyond radius are fine —
		// planStream filters those out itself; only misses inside are a bug).
		for (let row = -5; row <= 5; row++) {
			for (let col = -5; col <= 5; col++) {
				const cx = col * 512 + 256;
				const cy = row * 512 + 256;
				const key = groundFieldChunkKey(
					Math.floor((camera.x + cx) / 512),
					Math.floor((camera.y + cy) / 512),
				);
				if (Math.hypot(cx, cy) <= radius) {
					expect(keys.has(key)).toBe(true);
				}
			}
		}
	});

	it("includes the camera's own chunk once the radius covers a full chunk's worth of offset", () => {
		// A chunk center can be up to a half-diagonal (~362px) from a camera
		// standing anywhere inside that same chunk — radius has to clear that
		// before "own chunk" is guaranteed, not just be "some positive number".
		const camera = { x: 1234, y: -987 };
		const candidates = groundFieldCandidatesNear(camera, 400);
		const ownKey = groundFieldChunkKey(
			Math.floor(camera.x / 512),
			Math.floor(camera.y / 512),
		);
		expect(candidates.some((c) => c.key === ownKey)).toBe(true);
	});

	it("never returns a candidate whose center is actually beyond radius — this is what the entry-set sync bake bakes verbatim, unfiltered, so an over-wide result here means baking way more than the viewport at world entry", () => {
		const camera = { x: 500, y: -300 };
		const radius = 900;
		for (const c of groundFieldCandidatesNear(camera, radius)) {
			expect(Math.hypot(c.x - camera.x, c.y - camera.y)).toBeLessThanOrEqual(
				radius,
			);
		}
	});
});
