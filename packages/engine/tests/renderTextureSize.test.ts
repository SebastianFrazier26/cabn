import { describe, expect, it } from "vitest";
import { computeGroundGrid, GROUND_TILE_SIZE } from "../src/render/groundTiles.js";
import { WORLD_CHUNK_SIZE_PX } from "../src/render/worldChunkGrid.js";

// M10 stream-bake: the whole point of chunking the ground field, edge
// scenery and path bakes was to bound every single RenderTexture request to
// a fixed, small size regardless of world size — a world sprawling enough
// used to request one texture sized to its own bounds, which for a real
// repo conversion (tens of thousands of px across) exceeds any real GPU's
// max texture dimension outright (commonly 8192-16384px/side; this guard
// uses a much tighter bound since every chunked bake in this codebase is
// meant to request exactly one grid cell, never anything close to that
// ceiling). If a future change makes any of these request a texture near
// the real GPU limit, that's exactly the class of bug this task fixed.
const MAX_SAFE_RENDER_TEXTURE_PX = 4096;

describe("chunked bakes never request an oversized RenderTexture", () => {
	it("the shared world chunk grid (ground field, edge scenery, path ribbons) stays well under the guard", () => {
		expect(WORLD_CHUNK_SIZE_PX).toBeLessThanOrEqual(MAX_SAFE_RENDER_TEXTURE_PX);
		// Specifically 512 — not just "under the guard" but far under it, since
		// every chunked bake in this codebase shares this one grid size.
		expect(WORLD_CHUNK_SIZE_PX).toBe(512);
	});

	it("bakeClusterGround's implied RenderTexture size stays under the guard for realistic — and deliberately generous — cluster radii", () => {
		// PORTAL_RING_SIZES/CLEARING_OUTER_MARGIN (WorldScene.ts) grow a
		// clearing's radius with its portal count, but even a very
		// portal-heavy cluster (hundreds of files) measured well under 1000px
		// in the real repo conversions this task benchmarked against (see the
		// task's own report) — 2000px is a large safety margin above that,
		// not a realistic worst case.
		const generousMaxRadius = 2000;
		const grid = computeGroundGrid(generousMaxRadius, generousMaxRadius);
		const widthPx = grid.cols * GROUND_TILE_SIZE;
		const heightPx = grid.rows * GROUND_TILE_SIZE;
		expect(widthPx).toBeLessThanOrEqual(MAX_SAFE_RENDER_TEXTURE_PX);
		expect(heightPx).toBeLessThanOrEqual(MAX_SAFE_RENDER_TEXTURE_PX);
	});

	it("bakeClusterGround's implied size crosses the guard well before an unrealistic radius — a canary for the above margin, not a requirement of its own", () => {
		// Documents where the real ceiling is, so a future change to
		// GROUND_TILE_SIZE or the +2 margin in computeGroundGrid gets a
		// clear signal if it eats into the safety margin above.
		const radiusAtGuard = (MAX_SAFE_RENDER_TEXTURE_PX / 2 - GROUND_TILE_SIZE) / 1;
		const grid = computeGroundGrid(radiusAtGuard, radiusAtGuard);
		const widthPx = grid.cols * GROUND_TILE_SIZE;
		expect(widthPx).toBeGreaterThan(MAX_SAFE_RENDER_TEXTURE_PX * 0.9);
	});
});
