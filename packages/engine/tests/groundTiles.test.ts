import { describe, expect, it } from "vitest";
import {
	baseVariantIndex,
	computeGroundGrid,
	EDGE_E,
	EDGE_N,
	EDGE_S,
	EDGE_W,
	edgeMask,
	tileFrameFor,
} from "../src/render/groundTiles.js";

describe("computeGroundGrid", () => {
	it("marks the center tile inside and far corners outside", () => {
		const grid = computeGroundGrid(160, 100, 32);
		const centerCol = Math.floor(grid.cols / 2);
		const centerRow = Math.floor(grid.rows / 2);
		expect(grid.insideAt(centerCol, centerRow)).toBe(true);
		expect(grid.insideAt(0, 0)).toBe(false);
		expect(grid.insideAt(grid.cols - 1, grid.rows - 1)).toBe(false);
	});

	it("is symmetric about the center for a circle", () => {
		const grid = computeGroundGrid(128, 128, 32);
		const c = Math.floor(grid.cols / 2);
		const r = Math.floor(grid.rows / 2);
		for (let d = 0; d < c; d++) {
			expect(grid.insideAt(c + d, r)).toBe(grid.insideAt(c - 1 - d, r));
		}
	});
});

describe("edgeMask", () => {
	it("is 15 (all four bits) when every orthogonal neighbor is inside", () => {
		const insideAt = () => true;
		expect(edgeMask(insideAt, 5, 5)).toBe(EDGE_N | EDGE_E | EDGE_S | EDGE_W);
	});

	it("is 0 for an isolated inside cell with no inside neighbors", () => {
		const insideAt = (col: number, row: number) => col === 5 && row === 5;
		expect(edgeMask(insideAt, 5, 5)).toBe(0);
	});

	it("sets only the bit for the one inside neighbor present", () => {
		// Only north (row - 1) is inside.
		const insideAt = (col: number, row: number) => col === 5 && row === 4;
		expect(edgeMask(insideAt, 5, 5)).toBe(EDGE_N);
	});

	it("treats a neighbor outside the grid (predicate returns false) as not-inside", () => {
		const insideAt = (col: number, row: number) => col >= 0 && row >= 0;
		// (0, 0)'s north/west neighbors are (0,-1)/(-1,0) — both "outside the grid".
		expect(edgeMask(insideAt, 0, 0)).toBe(EDGE_E | EDGE_S);
	});
});

describe("baseVariantIndex", () => {
	it("is deterministic for the same position and seed", () => {
		expect(baseVariantIndex(3, 7, 4, 42)).toBe(baseVariantIndex(3, 7, 4, 42));
	});

	it("stays within [0, variantCount)", () => {
		for (let col = 0; col < 20; col++) {
			for (let row = 0; row < 20; row++) {
				const v = baseVariantIndex(col, row, 4, 42);
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThan(4);
			}
		}
	});

	it("produces more than one distinct value across a grid (texture breakup, not a constant)", () => {
		const values = new Set<number>();
		for (let col = 0; col < 10; col++) {
			for (let row = 0; row < 10; row++)
				values.add(baseVariantIndex(col, row, 4, 42));
		}
		expect(values.size).toBeGreaterThan(1);
	});
});

describe("tileFrameFor", () => {
	it("returns null for a cell outside the ground ellipse", () => {
		const insideAt = () => false;
		expect(
			tileFrameFor(insideAt, 0, 0, { variantCount: 4, seed: 1 }),
		).toBeNull();
	});

	it("returns a base-variant frame (< variantCount) for a fully interior cell", () => {
		const insideAt = () => true;
		const frame = tileFrameFor(insideAt, 3, 3, { variantCount: 4, seed: 1 });
		expect(frame).not.toBeNull();
		expect(frame as number).toBeLessThan(4);
	});

	it("returns variantCount + mask for an edge cell", () => {
		// The cell itself and only its north neighbor are inside -> mask 1.
		const insideAt = (col: number, row: number) =>
			col === 5 && (row === 5 || row === 4);
		const frame = tileFrameFor(insideAt, 5, 5, { variantCount: 4, seed: 1 });
		expect(frame).toBe(4 + EDGE_N);
	});
});
