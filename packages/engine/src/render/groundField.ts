import type Phaser from "phaser";
import { BIOME_TILE_VARIANT_COUNT } from "../assetPaths.js";
import { baseVariantIndex, GROUND_TILE_SIZE } from "./groundTiles.js";

export interface FieldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

// 16 tiles/side @ 32px = 512px per chunk — small enough that a chunk is a
// trivial one-time bake, large enough that even a big world's field is a
// handful of RenderTextures, not one per tile.
export const FIELD_CHUNK_TILES = 16;
const CHUNK_SIZE_PX = FIELD_CHUNK_TILES * GROUND_TILE_SIZE;

export interface ChunkRange {
	startCol: number;
	endCol: number;
	startRow: number;
	endRow: number;
}

/** Pure: which chunk grid indices cover `bounds` at `chunkSizePx` — split out from bakeGroundField so the coverage math (the part most likely to have an off-by-one at a chunk boundary) is testable without a Phaser scene. */
export function computeChunkRange(
	bounds: FieldBounds,
	chunkSizePx: number,
): ChunkRange {
	return {
		startCol: Math.floor(bounds.minX / chunkSizePx),
		endCol: Math.ceil(bounds.maxX / chunkSizePx),
		startRow: Math.floor(bounds.minY / chunkSizePx),
		endRow: Math.ceil(bounds.maxY / chunkSizePx),
	};
}

/**
 * Bakes one uniform, uninterrupted grass field across `bounds` — batch 2's
 * fix for batch 1's per-cluster ellipses leaving everything else as void.
 * Chunked into fixed-size `RenderTexture`s (one draw call each, `cols x
 * rows` chunks total for the whole scene, computed once at scene creation)
 * rather than one RT for the entire world — keeps any single texture's size
 * bounded regardless of how sprawling a project's layout gets, and leaves
 * room for frustum-based chunk culling later without restructuring this.
 * Every tile always resolves to a base grass variant (never an edge/blob
 * frame) since the field has no holes in it by construction — cluster
 * clearings are drawn as a separate, smaller bake on top (see
 * groundBaker.ts), not carved out of this one.
 */
export function bakeGroundField(
	scene: Phaser.Scene,
	bounds: FieldBounds,
	fieldSheetKey: string,
	seed: number,
): Phaser.GameObjects.RenderTexture[] {
	const { startCol, endCol, startRow, endRow } = computeChunkRange(
		bounds,
		CHUNK_SIZE_PX,
	);

	const chunks: Phaser.GameObjects.RenderTexture[] = [];
	for (let chunkRow = startRow; chunkRow < endRow; chunkRow++) {
		for (let chunkCol = startCol; chunkCol < endCol; chunkCol++) {
			const originX = chunkCol * CHUNK_SIZE_PX;
			const originY = chunkRow * CHUNK_SIZE_PX;
			const rt = scene.add.renderTexture(
				originX + CHUNK_SIZE_PX / 2,
				originY + CHUNK_SIZE_PX / 2,
				CHUNK_SIZE_PX,
				CHUNK_SIZE_PX,
			);

			for (let ty = 0; ty < FIELD_CHUNK_TILES; ty++) {
				for (let tx = 0; tx < FIELD_CHUNK_TILES; tx++) {
					// Absolute (not chunk-local) tile coordinates so the hashed
					// variant pick is continuous across a chunk boundary — a seam
					// there would defeat the whole point of a "continuous field".
					const absoluteCol = chunkCol * FIELD_CHUNK_TILES + tx;
					const absoluteRow = chunkRow * FIELD_CHUNK_TILES + ty;
					const frame = baseVariantIndex(
						absoluteCol,
						absoluteRow,
						BIOME_TILE_VARIANT_COUNT,
						seed,
					);
					rt.drawFrame(
						fieldSheetKey,
						frame,
						tx * GROUND_TILE_SIZE,
						ty * GROUND_TILE_SIZE,
					);
				}
			}
			chunks.push(rt);
		}
	}
	return chunks;
}
