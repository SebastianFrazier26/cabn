import { hashNoise2D } from "../systems/deterministicRandom.js";

// Matches tools/asset-pipeline's biome tile grids: a 16x16 pixel-map rendered
// through soften() at cellSize 2 comes out at exactly 32x32.
export const GROUND_TILE_SIZE = 32;

export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;

export interface GroundGrid {
	cols: number;
	rows: number;
	originX: number;
	originY: number;
	/** True if the tile at (col, row) is inside the cluster's biome ground ellipse. */
	insideAt: (col: number, row: number) => boolean;
}

/**
 * Lays a tile grid over a cluster's ground ellipse, in cluster-local space
 * (0,0 = cluster center). One ring of margin tiles is added on every side so
 * the outermost "inside" tiles always have room to render a transition edge
 * against a neutral surrounding tile, rather than being clipped at the grid
 * boundary.
 */
export function computeGroundGrid(
	radiusX: number,
	radiusY: number,
	tileSize = GROUND_TILE_SIZE,
): GroundGrid {
	const cols = Math.ceil((radiusX * 2) / tileSize) + 2;
	const rows = Math.ceil((radiusY * 2) / tileSize) + 2;
	const originX = -(cols * tileSize) / 2;
	const originY = -(rows * tileSize) / 2;
	const insideAt = (col: number, row: number): boolean => {
		const cx = originX + (col + 0.5) * tileSize;
		const cy = originY + (row + 0.5) * tileSize;
		return (cx / radiusX) ** 2 + (cy / radiusY) ** 2 <= 1;
	};
	return { cols, rows, originX, originY, insideAt };
}

/**
 * 4-neighbor (N/E/S/W) bitmask of which orthogonal neighbors are also inside
 * ground — the "blob-lite" tile-variant key (16 combinations, vs. the
 * 8-directional 47-tile scheme; chosen for this batch since a cluster's
 * ground is always a single smooth ellipse, never concave/irregular terrain,
 * so diagonal-neighbor corner cases the 47-tile set exists for don't come up).
 * A neighbor outside the grid counts as not-inside.
 */
export function edgeMask(
	insideAt: (col: number, row: number) => boolean,
	col: number,
	row: number,
): number {
	let mask = 0;
	if (insideAt(col, row - 1)) mask |= EDGE_N;
	if (insideAt(col + 1, row)) mask |= EDGE_E;
	if (insideAt(col, row + 1)) mask |= EDGE_S;
	if (insideAt(col - 1, row)) mask |= EDGE_W;
	return mask;
}

/** Deterministic base-grass-variant pick for a fully-interior tile — hashed by absolute grid position (not random) so the same world always tiles identically. */
export function baseVariantIndex(
	col: number,
	row: number,
	variantCount: number,
	seed: number,
): number {
	return Math.floor(hashNoise2D(col, row, seed) * variantCount);
}

/**
 * Which frame of a biome's tile sheet a grid cell should draw, or null for
 * "fully outside the ground ellipse — no ground tile here at all, the
 * neutral background shows through". Sheet layout (see gen-world-art.ts):
 * frames `0..variantCount-1` are base grass variants, `variantCount..
 * variantCount+15` are the 16 blob-edge frames indexed by mask. A fully
 * interior tile (mask 15, every neighbor also inside) uses a base variant
 * instead of the dedicated mask-15 edge frame — that frame exists in the
 * sheet only for uniform indexing and is otherwise unused.
 */
export function tileFrameFor(
	insideAt: (col: number, row: number) => boolean,
	col: number,
	row: number,
	opts: { variantCount: number; seed: number },
): number | null {
	if (!insideAt(col, row)) return null;
	const mask = edgeMask(insideAt, col, row);
	if (mask === 15)
		return baseVariantIndex(col, row, opts.variantCount, opts.seed);
	return opts.variantCount + mask;
}
