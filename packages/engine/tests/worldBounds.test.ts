import { describe, expect, it } from "vitest";
import { computeChunkRange } from "../src/render/groundField.js";
import { GROUND_TILE_SIZE } from "../src/render/groundTiles.js";
import { computeWorldBounds } from "../src/render/worldBounds.js";

// Matches groundField.ts's own FIELD_CHUNK_TILES * GROUND_TILE_SIZE (not
// exported — computeChunkRange takes the chunk size as a parameter, so the
// test recomputes it from the two pieces that are exported).
const FIELD_CHUNK_TILES = 16;
const CHUNK_SIZE_PX = FIELD_CHUNK_TILES * GROUND_TILE_SIZE;

const VIEWPORTS = [
	{ width: 1280, height: 720 },
	{ width: 1920, height: 1200 },
	{ width: 800, height: 600 },
	{ width: 320, height: 240 }, // smaller than any real viewport, exercises the MIN_BOUNDS_MARGIN_PX floor
];

const POINT_SETS: Array<{ name: string; points: { x: number; y: number }[] }> =
	[
		{ name: "single point at origin", points: [{ x: 0, y: 0 }] },
		{
			name: "two points north/south of origin (the shelf's own narrow-bounds case)",
			points: [
				{ x: 0, y: -480 },
				{ x: 0, y: 480 },
			],
		},
		{
			name: "widely spread cluster layout",
			points: [
				{ x: -906, y: -1305 },
				{ x: 857, y: 870 },
				{ x: 0, y: 0 },
				{ x: -400, y: 600 },
			],
		},
		{
			name: "all-negative points",
			points: [
				{ x: -1000, y: -1000 },
				{ x: -600, y: -600 },
			],
		},
	];

describe("computeWorldBounds", () => {
	it("always spans at least the full viewport on each axis", () => {
		for (const viewport of VIEWPORTS) {
			for (const { points } of POINT_SETS) {
				const bounds = computeWorldBounds(points, viewport);
				expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(
					viewport.width,
				);
				expect(bounds.maxY - bounds.minY).toBeGreaterThanOrEqual(
					viewport.height,
				);
			}
		}
	});

	it("always includes the origin, even when every point is off to one side", () => {
		const bounds = computeWorldBounds(
			[
				{ x: -1000, y: -1000 },
				{ x: -600, y: -600 },
			],
			{ width: 1280, height: 720 },
		);
		expect(bounds.minX).toBeLessThanOrEqual(0);
		expect(bounds.maxX).toBeGreaterThanOrEqual(0);
		expect(bounds.minY).toBeLessThanOrEqual(0);
		expect(bounds.maxY).toBeGreaterThanOrEqual(0);
	});

	it("shrinks (uses less margin) than the old scheme, which applied a single combined viewport/2+150 margin to every side regardless of axis", () => {
		// Regression guard for the M10 perf fix: the old formula computed one
		// `margin = max(WORLD_MARGIN, width/2 + 150, height/2 + 150)` and
		// applied it to *all four* sides — so on a 1280x720 viewport, even the
		// vertical margin was max(500, 790, 510) = 790, not something derived
		// from height at all. The new margin is per-axis (each axis padded by
		// its own half-viewport, not the larger of the two), so the vertical
		// margin here is well under the old cross-axis value even though a
		// small MIN_FOLLOW_ROOM_PX still sits on top of it (see the next test).
		const viewport = { width: 1280, height: 720 };
		const bounds = computeWorldBounds([{ x: 0, y: 0 }], viewport);
		const oldCombinedMargin = Math.max(
			500,
			viewport.width / 2 + 150,
			viewport.height / 2 + 150,
		);
		expect(bounds.maxY).toBeLessThan(oldCombinedMargin);
	});

	it("never lets bounds width/height exactly equal the viewport — the camera needs real scroll room to follow the player, not just enough to avoid a void", () => {
		// The bug this guards: half the viewport is the *minimum* margin that
		// keeps bounds >= viewport (see the doc above), but when every point
		// shares an axis coordinate (both of this demo shelf's cabins are at
		// x=0 — see ShelfScene.ts's layoutCabins), that minimum makes bounds
		// width exactly equal the viewport width: zero scroll range, so
		// `cameras.main.startFollow()` can never pan on that axis at all and
		// sits dead-centre on the origin regardless of where the player walks.
		// Caught by e2e/smoke.spec.ts's click-to-move assertion, which failed
		// deterministically (not flakily — confirmed by isolating this change
		// with `git stash`) before MIN_FOLLOW_ROOM_PX was added.
		for (const viewport of VIEWPORTS) {
			const bounds = computeWorldBounds(
				[
					{ x: 0, y: -480 },
					{ x: 0, y: 480 },
				],
				viewport,
			);
			expect(bounds.maxX - bounds.minX).toBeGreaterThan(viewport.width);
		}
	});
});

describe("computeWorldBounds + computeChunkRange", () => {
	it("the baked chunk grid always fully covers the computed world bounds — the reachable camera rect at any scroll extreme", () => {
		// Phaser's camera never scrolls its own view rectangle outside the
		// bounds passed to camera.setBounds(); since those bounds are exactly
		// this computeWorldBounds() box (see WorldScene/ShelfScene's
		// setupCamera), the camera's visible rect at any scroll position is
		// always inside this box. If the baked chunk grid didn't cover the
		// whole box, some reachable camera position would show unbaked
		// (background-coloured) ground — the exact bug this bounds/bake
		// sharing exists to prevent.
		for (const viewport of VIEWPORTS) {
			for (const { name, points } of POINT_SETS) {
				const bounds = computeWorldBounds(points, viewport);
				const range = computeChunkRange(bounds, CHUNK_SIZE_PX);
				const chunkMinX = range.startCol * CHUNK_SIZE_PX;
				const chunkMaxX = range.endCol * CHUNK_SIZE_PX;
				const chunkMinY = range.startRow * CHUNK_SIZE_PX;
				const chunkMaxY = range.endRow * CHUNK_SIZE_PX;

				expect(
					chunkMinX,
					`${name} @ ${viewport.width}x${viewport.height}`,
				).toBeLessThanOrEqual(bounds.minX);
				expect(
					chunkMaxX,
					`${name} @ ${viewport.width}x${viewport.height}`,
				).toBeGreaterThanOrEqual(bounds.maxX);
				expect(
					chunkMinY,
					`${name} @ ${viewport.width}x${viewport.height}`,
				).toBeLessThanOrEqual(bounds.minY);
				expect(
					chunkMaxY,
					`${name} @ ${viewport.width}x${viewport.height}`,
				).toBeGreaterThanOrEqual(bounds.maxY);
			}
		}
	});
});
