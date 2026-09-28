import type { PixelMap } from "./pixelmap.js";

/**
 * Procedural counterpart to the hand-authored ASCII `PixelMap`s in
 * `pixelmaps/*.ts` — world-art batch 1 needs dozens of small tiles/decals/
 * props (tile variants, blob edge tiles, per-item shading), and hand-typing
 * that many ASCII grids would be slower and harder to keep consistent than a
 * few shape primitives plus a legend-assigning converter. Grid cells are a
 * palette index or `null` (transparent); `toPixelMap` does the ASCII
 * round-trip so the result still flows through the existing
 * `renderPixelMap`/`soften` pipeline unchanged.
 */
export type Grid = (number | null)[][];

export function createGrid(width: number, height: number): Grid {
	return Array.from({ length: height }, () => new Array(width).fill(null));
}

export function gridWidth(grid: Grid): number {
	return grid[0]?.length ?? 0;
}

export function gridHeight(grid: Grid): number {
	return grid.length;
}

export function setPixel(grid: Grid, x: number, y: number, idx: number): void {
	const row = grid[y];
	if (!row || x < 0 || x >= row.length || y < 0 || y >= grid.length) return;
	row[x] = idx;
}

export function fillRect(
	grid: Grid,
	x0: number,
	y0: number,
	w: number,
	h: number,
	idx: number,
): void {
	for (let y = y0; y < y0 + h; y++) {
		for (let x = x0; x < x0 + w; x++) setPixel(grid, x, y, idx);
	}
}

/** Filled ellipse centered at (cx, cy) with radii (rx, ry), inclusive of the boundary. */
export function fillEllipse(
	grid: Grid,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	idx: number,
): void {
	const x0 = Math.floor(cx - rx);
	const x1 = Math.ceil(cx + rx);
	const y0 = Math.floor(cy - ry);
	const y1 = Math.ceil(cy + ry);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const nx = (x + 0.5 - cx) / rx;
			const ny = (y + 0.5 - cy) / ry;
			if (nx * nx + ny * ny <= 1) setPixel(grid, x, y, idx);
		}
	}
}

/** Half-space-test triangle fill — used for conical roofs/leaves, not worth pulling in a rasterization dependency for three points. */
export function fillTriangle(
	grid: Grid,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	idx: number,
): void {
	const minX = Math.floor(Math.min(x0, x1, x2));
	const maxX = Math.ceil(Math.max(x0, x1, x2));
	const minY = Math.floor(Math.min(y0, y1, y2));
	const maxY = Math.ceil(Math.max(y0, y1, y2));
	const sign = (
		ax: number,
		ay: number,
		bx: number,
		by: number,
		cx: number,
		cy: number,
	) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);

	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			const px = x + 0.5;
			const py = y + 0.5;
			const d1 = sign(px, py, x0, y0, x1, y1);
			const d2 = sign(px, py, x1, y1, x2, y2);
			const d3 = sign(px, py, x2, y2, x0, y0);
			const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
			const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
			if (!(hasNeg && hasPos)) setPixel(grid, x, y, idx);
		}
	}
}

/** A shadow/base/highlight palette-index triple — shared shape for anything that wants three-tone shading (biome ground tones, prop foliage, etc.). */
export interface GroundTonesLike {
	shadow: number;
	base: number;
	highlight: number;
}

/**
 * Three-tone volumetric shading over whatever's already filled inside the
 * given ellipse: pixels facing `lightAngleRad` get `highlight`, pixels facing
 * away get `shadow`, everything else keeps `base`. This is the "more shading
 * tones" pass batch 1 needs beyond a flat fill — soften()'s own per-cell
 * gradient only reacts to *adjacent* palette differences, so a single flat
 * color here would soften into a uniform block with no volume at all.
 */
export function shadeEllipseVolume(
	grid: Grid,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	tones: GroundTonesLike,
	lightAngleRad = -Math.PI * 0.75,
): void {
	const lx = Math.cos(lightAngleRad);
	const ly = Math.sin(lightAngleRad);
	const x0 = Math.floor(cx - rx);
	const x1 = Math.ceil(cx + rx);
	const y0 = Math.floor(cy - ry);
	const y1 = Math.ceil(cy + ry);
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const row = grid[y];
			if (!row || row[x] === undefined || row[x] === null) continue;
			const nx = (x + 0.5 - cx) / rx;
			const ny = (y + 0.5 - cy) / ry;
			if (nx * nx + ny * ny > 1) continue;
			const dot = nx * lx + ny * ly;
			row[x] =
				dot > 0.25 ? tones.highlight : dot < -0.25 ? tones.shadow : tones.base;
		}
	}
}

const LEGEND_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*+=";

/** Converts a Grid to the ASCII PixelMap shape, assigning legend chars in order of first appearance (deterministic given a deterministic grid). */
export function toPixelMap(name: string, grid: Grid): PixelMap {
	const width = gridWidth(grid);
	const height = gridHeight(grid);
	const legend: Record<string, number> = {};
	const charByIndex = new Map<number, string>();
	let next = 0;

	const rows = grid.map((row) =>
		row
			.map((idx) => {
				if (idx === null) return ".";
				let char = charByIndex.get(idx);
				if (!char) {
					char = LEGEND_ALPHABET[next];
					if (!char) {
						throw new Error(
							`${name}: more than ${LEGEND_ALPHABET.length} distinct palette indices, out of legend chars`,
						);
					}
					next++;
					charByIndex.set(idx, char);
					legend[char] = idx;
				}
				return char;
			})
			.join(""),
	);

	return { name, width, height, legend, rows };
}
