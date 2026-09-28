import { describe, expect, it } from "vitest";
import { computeChunkRange } from "../src/render/groundField.js";

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
