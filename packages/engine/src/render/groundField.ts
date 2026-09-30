import type Phaser from "phaser";
import { BIOME_TILE_VARIANT_COUNT } from "../assetPaths.js";
import { baseVariantIndex, GROUND_TILE_SIZE } from "./groundTiles.js";
import {
	type ChunkRange,
	computeChunkRange,
	WORLD_CHUNK_SIZE_PX,
} from "./worldChunkGrid.js";

export interface FieldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export type { ChunkRange };
// Re-exported: existing call sites (WorldScene.ts, ShelfScene.ts,
// groundField.test.ts) import both of these from here — worldChunkGrid.ts
// owns the actual grid math now, shared with sceneryBaker.ts and
// pathBaker.ts, but nothing outside this file needs to know that.
export { computeChunkRange };

// 16 tiles/side @ 32px = 512px per chunk, matching WORLD_CHUNK_SIZE_PX —
// small enough that a chunk is a trivial one-time bake, large enough that
// even a big world's field is a handful of RenderTextures, not one per tile.
export const FIELD_CHUNK_TILES = 16;
export const CHUNK_SIZE_PX = WORLD_CHUNK_SIZE_PX;

/** One chunk's tile draws: `{frame, x, y}` in chunk-local pixel space, in draw order. Pure — split out of bakeGroundFieldChunk so a streamed chunk's draw list can be diffed byte-for-byte against a full-world bake's (see chunkStream.test.ts / groundField.test.ts) without a Phaser scene. */
export interface GroundFieldDraw {
	frame: number;
	x: number;
	y: number;
}

export function groundFieldChunkDrawList(
	chunkCol: number,
	chunkRow: number,
	seed: number,
): GroundFieldDraw[] {
	const draws: GroundFieldDraw[] = [];
	for (let ty = 0; ty < FIELD_CHUNK_TILES; ty++) {
		for (let tx = 0; tx < FIELD_CHUNK_TILES; tx++) {
			// Absolute (not chunk-local) tile coordinates so the hashed variant
			// pick is continuous across a chunk boundary — a seam there would
			// defeat the whole point of a "continuous field", and would also
			// mean a chunk's own bake depended on which chunks bake alongside it.
			const absoluteCol = chunkCol * FIELD_CHUNK_TILES + tx;
			const absoluteRow = chunkRow * FIELD_CHUNK_TILES + ty;
			const frame = baseVariantIndex(
				absoluteCol,
				absoluteRow,
				BIOME_TILE_VARIANT_COUNT,
				seed,
			);
			draws.push({ frame, x: tx * GROUND_TILE_SIZE, y: ty * GROUND_TILE_SIZE });
		}
	}
	return draws;
}

/** One field chunk's bake, callable standalone by the streamer (chunkStream.ts) — identical pixels to whatever bakeGroundField would have drawn for the same (chunkCol, chunkRow), since both go through groundFieldChunkDrawList. */
export function bakeGroundFieldChunk(
	scene: Phaser.Scene,
	chunkCol: number,
	chunkRow: number,
	fieldSheetKey: string,
	seed: number,
	tint?: number,
): Phaser.GameObjects.RenderTexture {
	const originX = chunkCol * CHUNK_SIZE_PX;
	const originY = chunkRow * CHUNK_SIZE_PX;
	const rt = scene.add.renderTexture(
		originX + CHUNK_SIZE_PX / 2,
		originY + CHUNK_SIZE_PX / 2,
		CHUNK_SIZE_PX,
		CHUNK_SIZE_PX,
	);
	for (const draw of groundFieldChunkDrawList(chunkCol, chunkRow, seed)) {
		rt.drawFrame(fieldSheetKey, draw.frame, draw.x, draw.y);
	}
	if (tint !== undefined) rt.setTint(tint);
	return rt;
}

/**
 * Bakes one uniform, uninterrupted grass field across `bounds` — batch 2's
 * fix for batch 1's per-cluster ellipses leaving everything else as void.
 * Chunked into fixed-size `RenderTexture`s (one draw call each, `cols x
 * rows` chunks total for the whole scene, computed once at scene creation)
 * rather than one RT for the entire world — keeps any single texture's size
 * bounded regardless of how sprawling a project's layout gets. Still used
 * whole-bounds by ShelfScene (small, fixed cabin count — see M10 stream-bake
 * task notes) and as the non-streamed fallback; WorldScene instead streams
 * chunks in via bakeGroundFieldChunk + render/chunkStream.ts, one at a time,
 * bounded by the camera's view rather than by the whole world's bounds.
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
	/** A world skin's multiply tint (systems/worldLayer.ts); omitted, the art's own colours. */
	tint?: number,
): Phaser.GameObjects.RenderTexture[] {
	const { startCol, endCol, startRow, endRow } = computeChunkRange(
		bounds,
		CHUNK_SIZE_PX,
	);

	const chunks: Phaser.GameObjects.RenderTexture[] = [];
	for (let chunkRow = startRow; chunkRow < endRow; chunkRow++) {
		for (let chunkCol = startCol; chunkCol < endCol; chunkCol++) {
			chunks.push(
				bakeGroundFieldChunk(
					scene,
					chunkCol,
					chunkRow,
					fieldSheetKey,
					seed,
					tint,
				),
			);
		}
	}
	return chunks;
}
