import { describe, expect, it } from "vitest";
import { DECAL_FRAME_SIZE } from "../src/assetPaths.js";
import {
	assignDrawsToTiles,
	CLUSTER_TILE_PX,
	type ClusterGroundDraw,
	clusterTileLocalKey,
	layoutClusterTiles,
	planClusterGroundDraws,
} from "../src/render/clusterGroundPlan.js";
import { computeGroundGrid } from "../src/render/groundTiles.js";

const RADII: [number, number][] = [
	[120, 90],
	[400, 380],
	[700, 520],
	[1376, 1392],
];

function plan(rx: number, ry: number): ClusterGroundDraw[] {
	return planClusterGroundDraws({
		clusterId: `c-${rx}`,
		radiusX: rx,
		radiusY: ry,
		localExclusions: [{ x: 0, y: 0, radius: 60 }],
		decalCount: 40,
		ringFlowerCount: 24,
		seed: 7,
	});
}

const overlaps = (d: ClusterGroundDraw, col: number, row: number) =>
	d.x < (col + 1) * CLUSTER_TILE_PX &&
	d.x + d.size > col * CLUSTER_TILE_PX &&
	d.y < (row + 1) * CLUSTER_TILE_PX &&
	d.y + d.size > row * CLUSTER_TILE_PX;

describe("cluster ground tiling", () => {
	it.each(RADII)(
		"every draw lands in exactly the tiles it overlaps (%i x %i)",
		(rx, ry) => {
			const draws = plan(rx, ry);
			const byTile = assignDrawsToTiles(draws);
			const layout = layoutClusterTiles(rx, ry);
			for (let row = 0; row < layout.tileRows; row++) {
				for (let col = 0; col < layout.tileCols; col++) {
					const expected = draws.filter((d) => overlaps(d, col, row));
					expect(byTile.get(clusterTileLocalKey(col, row)) ?? []).toEqual(
						expected,
					);
				}
			}
		},
	);

	it.each(RADII)(
		"a tile's draws keep the cluster's paint order: tiles, then decals (%i x %i)",
		(rx, ry) => {
			for (const list of assignDrawsToTiles(plan(rx, ry)).values()) {
				const firstDecal = list.findIndex((d) => d.sheet === "decal");
				if (firstDecal >= 0)
					expect(list.slice(firstDecal).every((d) => d.sheet === "decal")).toBe(
						true,
					);
			}
		},
	);

	it.each(RADII)(
		"layout lists every tile that has a draw (%i x %i)",
		(rx, ry) => {
			const listed = new Set(
				layoutClusterTiles(rx, ry).tiles.map((t) =>
					clusterTileLocalKey(t.col, t.row),
				),
			);
			for (const key of assignDrawsToTiles(plan(rx, ry)).keys()) {
				expect(listed.has(key)).toBe(true);
			}
		},
	);

	it("a decal straddling a tile edge is drawn in both tiles", () => {
		const straddler: ClusterGroundDraw = {
			sheet: "decal",
			frame: 0,
			x: CLUSTER_TILE_PX - DECAL_FRAME_SIZE / 2,
			y: 10,
			size: DECAL_FRAME_SIZE,
		};
		const byTile = assignDrawsToTiles([straddler]);
		expect(byTile.get("0,0")).toEqual([straddler]);
		expect(byTile.get("1,0")).toEqual([straddler]);
		expect(byTile.size).toBe(2);
	});

	it("a draw ending exactly on a tile edge does not spill into the next tile", () => {
		const flush: ClusterGroundDraw = {
			sheet: "tile",
			frame: 0,
			x: CLUSTER_TILE_PX - 32,
			y: 0,
			size: 32,
		};
		expect([...assignDrawsToTiles([flush]).keys()]).toEqual(["0,0"]);
	});

	it("no tile exceeds the 512px bound and the grid is fully covered", () => {
		for (const [rx, ry] of RADII) {
			const grid = computeGroundGrid(rx, ry);
			const layout = layoutClusterTiles(rx, ry);
			expect(layout.tileCols * CLUSTER_TILE_PX).toBeGreaterThanOrEqual(
				grid.cols * 32,
			);
			expect(layout.tileRows * CLUSTER_TILE_PX).toBeGreaterThanOrEqual(
				grid.rows * 32,
			);
			expect((layout.tileCols - 1) * CLUSTER_TILE_PX).toBeLessThan(
				grid.cols * 32,
			);
		}
	});

	it("the big 29-portal-scale clearing is many tiles, none of them whole-cluster sized", () => {
		expect(layoutClusterTiles(1376, 1392).tiles.length).toBeGreaterThan(9);
	});
});
