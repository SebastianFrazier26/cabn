import type Phaser from "phaser";
import { BIOME_TILE_VARIANT_COUNT } from "../assetPaths.js";
import type { Point, StreamCandidate } from "./chunkStream.js";
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
export const CHUNK_SIZE_PX = FIELD_CHUNK_TILES * GROUND_TILE_SIZE;

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

export function groundFieldChunkKey(
	chunkCol: number,
	chunkRow: number,
): string {
	return `${chunkCol},${chunkRow}`;
}

export function parseGroundFieldChunkKey(key: string): {
	chunkCol: number;
	chunkRow: number;
} {
	const [col, row] = key.split(",").map(Number);
	return { chunkCol: col ?? 0, chunkRow: row ?? 0 };
}

function groundFieldChunkCenter(chunkCol: number, chunkRow: number): Point {
	return {
		x: chunkCol * CHUNK_SIZE_PX + CHUNK_SIZE_PX / 2,
		y: chunkRow * CHUNK_SIZE_PX + CHUNK_SIZE_PX / 2,
	};
}

export function groundFieldPositionOf(key: string): Point {
	const { chunkCol, chunkRow } = parseGroundFieldChunkKey(key);
	return groundFieldChunkCenter(chunkCol, chunkRow);
}

/**
 * Every field-chunk key whose center falls within `radius` of `camera` —
 * chunkStream.ts's streamer calls this each frame as its bounded
 * `loadCandidates` window (see that module's doc comment on why the window
 * only needs to cover loadRadius, not the whole world): the scan itself is
 * bounded by `radius`/CHUNK_SIZE_PX squared, not by how many chunks the
 * world has in total.
 */
export function groundFieldCandidatesNear(
	camera: Point,
	radius: number,
): StreamCandidate<string>[] {
	const chunkRadius = Math.ceil(radius / CHUNK_SIZE_PX) + 1;
	const centerCol = Math.floor(camera.x / CHUNK_SIZE_PX);
	const centerRow = Math.floor(camera.y / CHUNK_SIZE_PX);
	const out: StreamCandidate<string>[] = [];
	for (
		let row = centerRow - chunkRadius;
		row <= centerRow + chunkRadius;
		row++
	) {
		for (
			let col = centerCol - chunkRadius;
			col <= centerCol + chunkRadius;
			col++
		) {
			const { x, y } = groundFieldChunkCenter(col, row);
			out.push({ key: groundFieldChunkKey(col, row), x, y });
		}
	}
	return out;
}
