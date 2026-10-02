import { describe, expect, it } from "vitest";
import {
	computeChunkRange,
	indexPointsByChunk,
	parseWorldChunkKey,
	worldChunkCandidatesNear,
	worldChunkKey,
	worldChunkPositionOf,
} from "../src/render/worldChunkGrid.js";

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

describe("worldChunkKey / parseWorldChunkKey / worldChunkPositionOf", () => {
	it("round-trips through key parsing, including negative coordinates", () => {
		expect(parseWorldChunkKey(worldChunkKey(-3, 7))).toEqual({
			col: -3,
			row: 7,
		});
	});

	it("positionOf returns each chunk's own center in world space", () => {
		expect(worldChunkPositionOf(worldChunkKey(0, 0))).toEqual({
			x: 256,
			y: 256,
		});
		expect(worldChunkPositionOf(worldChunkKey(-1, -1))).toEqual({
			x: -256,
			y: -256,
		});
	});
});

describe("worldChunkCandidatesNear", () => {
	it("returns a bounded window regardless of how far `radius` conceptually reaches — scan cost is O((radius/chunkSize)^2), not O(world size)", () => {
		const small = worldChunkCandidatesNear({ x: 0, y: 0 }, 600);
		const large = worldChunkCandidatesNear({ x: 0, y: 0 }, 6000);
		// A 10x bigger radius gives a proportionally bigger (but still finite,
		// still cheap) window — this is the assertion that actually matters:
		// nothing here scales with total world chunk count.
		expect(large.length).toBeGreaterThan(small.length);
		expect(large.length).toBeLessThan(2000);
	});

	it('never misses a chunk whose center is genuinely within radius — planStream can only load what\'s in this window, so a gap here is a silent "never streams in" bug', () => {
		const camera = { x: 1000, y: -500 };
		const radius = 800;
		const candidates = worldChunkCandidatesNear(camera, radius);
		const keys = new Set(candidates.map((c) => c.key));
		// Sweep a grid of chunk centers well past `radius` and confirm every one
		// truly inside it appears in the window (extras beyond radius are fine —
		// planStream filters those out itself; only misses inside are a bug).
		for (let row = -5; row <= 5; row++) {
			for (let col = -5; col <= 5; col++) {
				const cx = col * 512 + 256;
				const cy = row * 512 + 256;
				const key = worldChunkKey(
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
		const candidates = worldChunkCandidatesNear(camera, 400);
		const ownKey = worldChunkKey(
			Math.floor(camera.x / 512),
			Math.floor(camera.y / 512),
		);
		expect(candidates.some((c) => c.key === ownKey)).toBe(true);
	});

	it("never returns a candidate whose center is actually beyond radius — a streamer's entry-set sync bake uses this verbatim, unfiltered, so an over-wide result here means baking way more than the viewport at world entry", () => {
		const camera = { x: 500, y: -300 };
		const radius = 900;
		for (const c of worldChunkCandidatesNear(camera, radius)) {
			expect(Math.hypot(c.x - camera.x, c.y - camera.y)).toBeLessThanOrEqual(
				radius,
			);
		}
	});
});

describe("indexPointsByChunk", () => {
	it("bins a point entirely inside one chunk into only that chunk", () => {
		const index = indexPointsByChunk([{ x: 100, y: 100 }], 10, 512);
		expect([...index.keys()]).toEqual(["0,0"]);
		expect(index.get("0,0")).toEqual([0]);
	});

	it("bins a stamp straddling a vertical seam into both neighboring chunks", () => {
		// Chunk boundary at x=512; a point at x=510 with radius 20 spans
		// [490, 530] — inside both chunk 0 (cols 0..511) and chunk 1 (512..1023).
		const index = indexPointsByChunk([{ x: 510, y: 100 }], 20, 512);
		expect(index.get("0,0")).toEqual([0]);
		expect(index.get("1,0")).toEqual([0]);
		expect(index.size).toBe(2);
	});

	it("bins a stamp straddling a corner (both axes) into all four neighboring chunks", () => {
		const index = indexPointsByChunk([{ x: 510, y: 510 }], 20, 512);
		expect(new Set(index.keys())).toEqual(
			new Set(["0,0", "1,0", "0,1", "1,1"]),
		);
	});

	it("preserves each point's original index, for points that land in more than one chunk", () => {
		const index = indexPointsByChunk(
			[
				{ x: 100, y: 100 },
				{ x: 510, y: 100 },
			],
			20,
			512,
		);
		expect(index.get("0,0")?.sort()).toEqual([0, 1]);
		expect(index.get("1,0")).toEqual([1]);
	});

	it("handles negative coordinates the same way", () => {
		const index = indexPointsByChunk([{ x: -510, y: -510 }], 20, 512);
		expect(new Set(index.keys())).toEqual(
			new Set(["-2,-2", "-1,-2", "-2,-1", "-1,-1"]),
		);
	});
});
