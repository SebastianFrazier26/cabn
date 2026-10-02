import {
	createGrid,
	fillEllipse,
	fillRect,
	fillTriangle,
	type Grid,
	type GroundTonesLike,
	setPixel,
	shadeEllipseVolume,
} from "../pixel-shapes.js";

/**
 * Draws a coarse "base unit" design onto a fine grid `k` times denser — the
 * shared mechanism that puts scenery and scatter props on the same 2px-per-
 * cell density as the tower, cabins and player (see scenery.ts's doc
 * comment). `pad` adds that many empty fine cells on every side, so an
 * outline pass has room to ring shapes that touch the design's edge.
 */
export interface Pen {
	g: Grid;
	k: number;
	rect(x: number, y: number, w: number, h: number, idx: number): void;
	ellipse(cx: number, cy: number, rx: number, ry: number, idx: number): void;
	tri(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		idx: number,
	): void;
	/** One base-unit block. */
	px(x: number, y: number, idx: number): void;
	/** One fine cell, in fine coordinates (pad not applied — callers pass raw grid coordinates). */
	fine(x: number, y: number, idx: number): void;
	/** Base-unit coordinate -> fine grid coordinate, pad included. */
	at(v: number): number;
	shade(
		cx: number,
		cy: number,
		rx: number,
		ry: number,
		tones: GroundTonesLike,
	): void;
	/** Deterministically flips a fraction of `from`-colored fine cells in a base-unit box to `to` — leaf/stone texture at the fine cell size. */
	speckle(
		x: number,
		y: number,
		w: number,
		h: number,
		from: number,
		to: number,
		density: number,
		seed: number,
	): void;
}

export function cellHash(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

export function pen(width: number, height: number, k: number, pad = 0): Pen {
	const g = createGrid(
		Math.round(width * k) + pad * 2,
		Math.round(height * k) + pad * 2,
	);
	const r = Math.round;
	const at = (v: number) => r(v * k) + pad;
	return {
		g,
		k,
		at,
		rect: (x, y, w, h, idx) =>
			fillRect(g, at(x), at(y), r(w * k), r(h * k), idx),
		ellipse: (cx, cy, rx, ry, idx) =>
			fillEllipse(g, cx * k + pad, cy * k + pad, rx * k, ry * k, idx),
		tri: (x0, y0, x1, y1, x2, y2, idx) =>
			fillTriangle(
				g,
				x0 * k + pad,
				y0 * k + pad,
				x1 * k + pad,
				y1 * k + pad,
				x2 * k + pad,
				y2 * k + pad,
				idx,
			),
		px: (x, y, idx) => fillRect(g, at(x), at(y), k, k, idx),
		fine: (x, y, idx) => setPixel(g, x, y, idx),
		shade: (cx, cy, rx, ry, tones) =>
			shadeEllipseVolume(g, cx * k + pad, cy * k + pad, rx * k, ry * k, tones),
		speckle: (x, y, w, h, from, to, density, seed) => {
			for (let fy = at(y); fy < at(y + h); fy++) {
				const row = g[fy];
				if (!row) continue;
				for (let fx = at(x); fx < at(x + w); fx++) {
					if (row[fx] === from && cellHash(fx, fy, seed) < density)
						row[fx] = to;
				}
			}
		},
	};
}
