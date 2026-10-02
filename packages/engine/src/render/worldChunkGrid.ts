/**
 * One shared 512px world-space grid, keyed identically everywhere it's used
 * (groundField.ts, sceneryBaker.ts, pathBaker.ts) — so a ground chunk, a
 * scenery chunk and a path chunk at the same (col, row) provably cover the
 * exact same square, and the streamer in chunkStream.ts can drive all three
 * off one set of chunk keys without each caller re-deriving its own grid
 * math (previously duplicated between groundField.ts and sceneryBaker.ts as
 * two separately-hardcoded `512`s that happened to agree).
 */

import type { Point, StreamCandidate } from "./chunkStream.js";

export const WORLD_CHUNK_SIZE_PX = 512;

export function worldChunkKey(col: number, row: number): string {
	return `${col},${row}`;
}

export function parseWorldChunkKey(key: string): { col: number; row: number } {
	const [col, row] = key.split(",").map(Number);
	return { col: col ?? 0, row: row ?? 0 };
}

export function worldChunkCenter(
	col: number,
	row: number,
	chunkSize = WORLD_CHUNK_SIZE_PX,
): Point {
	return {
		x: col * chunkSize + chunkSize / 2,
		y: row * chunkSize + chunkSize / 2,
	};
}

export interface ChunkRange {
	startCol: number;
	endCol: number;
	startRow: number;
	endRow: number;
}

export interface RectBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Which chunk grid indices cover `bounds` at `chunkSize` — outward-rounded, never inward, so a bounds box that doesn't land on a chunk edge still gets full coverage (see groundField.test.ts's original coverage tests, moved here). */
export function computeChunkRange(
	bounds: RectBounds,
	chunkSize = WORLD_CHUNK_SIZE_PX,
): ChunkRange {
	return {
		startCol: Math.floor(bounds.minX / chunkSize),
		endCol: Math.ceil(bounds.maxX / chunkSize),
		startRow: Math.floor(bounds.minY / chunkSize),
		endRow: Math.ceil(bounds.maxY / chunkSize),
	};
}

export function worldChunkPositionOf(
	key: string,
	chunkSize = WORLD_CHUNK_SIZE_PX,
): Point {
	const { col, row } = parseWorldChunkKey(key);
	return worldChunkCenter(col, row, chunkSize);
}

/**
 * Every chunk key whose center falls within `radius` of `camera` — every
 * streamed chunk system (ground field, edge scenery, path ribbons) calls
 * this each frame as its bounded `loadCandidates` window: the scan is
 * bounded by `radius`/`chunkSize` squared, not by how many chunks the world
 * has in total, so an over-wide window here costs a few extra distance
 * checks, never a scan of the whole world.
 */
export function worldChunkCandidatesNear(
	camera: Point,
	radius: number,
	chunkSize = WORLD_CHUNK_SIZE_PX,
): StreamCandidate<string>[] {
	const chunkRadius = Math.ceil(radius / chunkSize) + 1;
	const centerCol = Math.floor(camera.x / chunkSize);
	const centerRow = Math.floor(camera.y / chunkSize);
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
			const { x, y } = worldChunkCenter(col, row, chunkSize);
			if (Math.hypot(x - camera.x, y - camera.y) > radius) continue;
			out.push({ key: worldChunkKey(col, row), x, y });
		}
	}
	return out;
}

export interface RadiusedPoint {
	x: number;
	y: number;
}

/**
 * Bins every point into the chunk(s) whose square overlaps a `radius`-sized
 * box around it (radius: half the drawn footprint — a texture's own half-
 * width/diagonal, not the point itself) — the spatial index a chunked bake
 * uses so baking one chunk only visits the points that actually touch it,
 * not every point in the world. A point exactly on a seam lands in every
 * chunk its box overlaps, once each, so each chunk's own draw clips its own
 * part and the seam is invisible (same reasoning as sceneryBaker.ts's
 * existing per-item chunk assignment, generalized so pathBaker.ts's stamps
 * can use the same index shape).
 */
export function indexPointsByChunk(
	points: readonly RadiusedPoint[],
	radius: number,
	chunkSize = WORLD_CHUNK_SIZE_PX,
): Map<string, number[]> {
	const index = new Map<string, number[]>();
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		if (!p) continue;
		const { startCol, endCol, startRow, endRow } = computeChunkRange(
			{
				minX: p.x - radius,
				minY: p.y - radius,
				maxX: p.x + radius,
				maxY: p.y + radius,
			},
			chunkSize,
		);
		for (let row = startRow; row < endRow; row++) {
			for (let col = startCol; col < endCol; col++) {
				const key = worldChunkKey(col, row);
				const list = index.get(key);
				if (list) list.push(i);
				else index.set(key, [i]);
			}
		}
	}
	return index;
}
