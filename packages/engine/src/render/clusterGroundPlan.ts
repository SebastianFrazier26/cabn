import {
	BIOME_TILE_VARIANT_COUNT,
	DECAL_COUNT,
	DECAL_FRAME_SIZE,
} from "../assetPaths.js";
import { placeScatter, type ScatterExclusion } from "../systems/scatter.js";
import {
	computeGroundGrid,
	GROUND_TILE_SIZE,
	tileFrameFor,
} from "./groundTiles.js";
import { WORLD_CHUNK_SIZE_PX } from "./worldChunkGrid.js";

/** A cluster's ground is baked in square tiles of this many px, aligned to the cluster's own grid (not the world chunk grid) so a 32px ground cell never straddles two tiles. */
export const CLUSTER_TILE_PX = WORLD_CHUNK_SIZE_PX;
const CELLS_PER_TILE = CLUSTER_TILE_PX / GROUND_TILE_SIZE;

// decals.ts's buildDecals() order: 0 = flower-pink, 1 = flower-blue.
const RING_FLOWER_VARIANTS = [0, 1];

export interface ClusterGroundDraw {
	sheet: "tile" | "decal";
	frame: number;
	/** Top-left in px, relative to the cluster grid's own top-left corner. */
	x: number;
	y: number;
	size: number;
}

export interface ClusterGroundPlanParams {
	clusterId: string;
	radiusX: number;
	radiusY: number;
	/** Exclusions in cluster-local space (0,0 = cluster centre). */
	localExclusions: readonly ScatterExclusion[];
	decalCount: number;
	decalMinSpacing?: number;
	ringFlowerCount?: number;
	seed: number;
}

/** Every draw of a cluster's ground in paint order: tiles, then scattered decals, then the ring of flowers. Pure so tiling it can be tested without a scene. */
export function planClusterGroundDraws(
	params: ClusterGroundPlanParams,
): ClusterGroundDraw[] {
	const { radiusX, radiusY } = params;
	const grid = computeGroundGrid(radiusX, radiusY, GROUND_TILE_SIZE);
	const draws: ClusterGroundDraw[] = [];
	for (let row = 0; row < grid.rows; row++) {
		for (let col = 0; col < grid.cols; col++) {
			const frame = tileFrameFor(grid.insideAt, col, row, {
				variantCount: BIOME_TILE_VARIANT_COUNT,
				seed: params.seed,
			});
			if (frame === null) continue;
			draws.push({
				sheet: "tile",
				frame,
				x: col * GROUND_TILE_SIZE,
				y: row * GROUND_TILE_SIZE,
				size: GROUND_TILE_SIZE,
			});
		}
	}
	const decals = placeScatter({
		clusterId: `${params.clusterId}:decals`,
		centerX: 0,
		centerY: 0,
		radiusX,
		radiusY,
		count: params.decalCount,
		minSpacing: params.decalMinSpacing ?? 20,
		variantCount: DECAL_COUNT,
		exclusions: params.localExclusions,
	});
	for (const decal of decals) {
		draws.push({
			sheet: "decal",
			frame: decal.variant,
			x: decal.x - grid.originX - DECAL_FRAME_SIZE / 2,
			y: decal.y - grid.originY - DECAL_FRAME_SIZE / 2,
			size: DECAL_FRAME_SIZE,
		});
	}
	const ringCount = params.ringFlowerCount ?? 0;
	for (let i = 0; i < ringCount; i++) {
		const angle = (Math.PI * 2 * i) / ringCount;
		const x = Math.cos(angle) * radiusX * 0.92;
		const y = Math.sin(angle) * radiusY * 0.92;
		draws.push({
			sheet: "decal",
			frame: RING_FLOWER_VARIANTS[i % RING_FLOWER_VARIANTS.length] ?? 0,
			x: x - grid.originX - DECAL_FRAME_SIZE / 2,
			y: y - grid.originY - DECAL_FRAME_SIZE / 2,
			size: DECAL_FRAME_SIZE,
		});
	}
	return draws;
}

export function clusterTileLocalKey(col: number, row: number): string {
	return `${col},${row}`;
}

/** Every tile (by `col,row` within the cluster) whose rect a draw overlaps, in paint order. A draw straddling a tile edge lands in each tile it touches and is clipped by each tile's own bounds, so the seam is invisible — same rule as indexPointsByChunk. */
export function assignDrawsToTiles(
	draws: readonly ClusterGroundDraw[],
	tilePx: number = CLUSTER_TILE_PX,
): Map<string, ClusterGroundDraw[]> {
	const byTile = new Map<string, ClusterGroundDraw[]>();
	for (const draw of draws) {
		const c0 = Math.floor(draw.x / tilePx);
		const c1 = Math.ceil((draw.x + draw.size) / tilePx) - 1;
		const r0 = Math.floor(draw.y / tilePx);
		const r1 = Math.ceil((draw.y + draw.size) / tilePx) - 1;
		for (let row = r0; row <= r1; row++) {
			for (let col = c0; col <= c1; col++) {
				const key = clusterTileLocalKey(col, row);
				const list = byTile.get(key);
				if (list) list.push(draw);
				else byTile.set(key, [draw]);
			}
		}
	}
	return byTile;
}

export interface ClusterTileLayout {
	/** The cluster grid's top-left corner relative to the cluster centre. */
	originX: number;
	originY: number;
	tileCols: number;
	tileRows: number;
	/** Tiles that can hold any draw, `col,row` keyed — a superset (a listed tile may bake nothing), never missing one that has a draw. */
	tiles: { col: number; row: number }[];
}

/** The cheap half of the plan — geometry only, no scatter — so a streamer can list every tile of every cluster up front without placing decals for clusters nobody has walked to. */
export function layoutClusterTiles(
	radiusX: number,
	radiusY: number,
): ClusterTileLayout {
	const grid = computeGroundGrid(radiusX, radiusY, GROUND_TILE_SIZE);
	const tileCols = Math.ceil(grid.cols / CELLS_PER_TILE);
	const tileRows = Math.ceil(grid.rows / CELLS_PER_TILE);
	const reach = Math.max(GROUND_TILE_SIZE, DECAL_FRAME_SIZE) / 2;
	const tiles: { col: number; row: number }[] = [];
	for (let row = 0; row < tileRows; row++) {
		for (let col = 0; col < tileCols; col++) {
			const minX = grid.originX + col * CLUSTER_TILE_PX - reach;
			const maxX = minX + CLUSTER_TILE_PX + reach * 2;
			const minY = grid.originY + row * CLUSTER_TILE_PX - reach;
			const maxY = minY + CLUSTER_TILE_PX + reach * 2;
			// Separable, so the rect's minimum of (x/a)^2 + (y/b)^2 is at the
			// point nearest the origin on each axis independently.
			const nx = minX > 0 ? minX : maxX < 0 ? maxX : 0;
			const ny = minY > 0 ? minY : maxY < 0 ? maxY : 0;
			if ((nx / radiusX) ** 2 + (ny / radiusY) ** 2 <= 1) {
				tiles.push({ col, row });
			}
		}
	}
	return {
		originX: grid.originX,
		originY: grid.originY,
		tileCols,
		tileRows,
		tiles,
	};
}
