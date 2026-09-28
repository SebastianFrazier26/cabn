import type { PixelMap } from "../pixelmap.js";
import { LIGHT_DIR, type ShadeBand, sphereBand } from "./ui-icon-shading.js";

/**
 * Tiny char-grid canvas for the tool-screen frames (crystal ball, spyglass
 * lens, satchel) — they're far bigger than the item icons (100+ cells a
 * side), so they're built from a few shape calls rather than per-pixel
 * `pixelAt` functions, but still emit the same ASCII PixelMap every other
 * UI asset uses.
 */
export interface ScreenCanvas {
	width: number;
	height: number;
	get(x: number, y: number): string;
	set(x: number, y: number, ch: string): void;
	/** Cells with centre inside the ellipse. */
	ellipse(
		cx: number,
		cy: number,
		rx: number,
		ry: number,
		pick: (x: number, y: number, nx: number, ny: number) => string | null,
	): void;
	rect(
		x: number,
		y: number,
		w: number,
		h: number,
		pick: (x: number, y: number) => string | null,
	): void;
	/** 1-cell outline in `ch` around every filled cell's empty 4-neighbours. */
	outline(ch: string): void;
	toPixelMap(name: string, legend: Record<string, number>): PixelMap;
}

export function screenCanvas(width: number, height: number): ScreenCanvas {
	const cells: string[][] = Array.from({ length: height }, () =>
		new Array(width).fill("."),
	);
	const inside = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < width && y < height;
	const c: ScreenCanvas = {
		width,
		height,
		get: (x, y) => (inside(x, y) ? (cells[y]?.[x] ?? ".") : "."),
		set: (x, y, ch) => {
			const row = cells[y];
			if (row && inside(x, y)) row[x] = ch;
		},
		ellipse: (cx, cy, rx, ry, pick) => {
			for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
				for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
					const nx = (x + 0.5 - cx) / rx;
					const ny = (y + 0.5 - cy) / ry;
					if (nx * nx + ny * ny > 1) continue;
					const ch = pick(x, y, nx, ny);
					if (ch) c.set(x, y, ch);
				}
			}
		},
		rect: (x0, y0, w, h, pick) => {
			for (let y = y0; y < y0 + h; y++) {
				for (let x = x0; x < x0 + w; x++) {
					const ch = pick(x, y);
					if (ch) c.set(x, y, ch);
				}
			}
		},
		outline: (ch) => {
			const edge: [number, number][] = [];
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					if (c.get(x, y) !== ".") continue;
					const filled = (dx: number, dy: number) =>
						inside(x + dx, y + dy) && c.get(x + dx, y + dy) !== ".";
					if (filled(1, 0) || filled(-1, 0) || filled(0, 1) || filled(0, -1))
						edge.push([x, y]);
				}
			}
			for (const [x, y] of edge) c.set(x, y, ch);
		},
		toPixelMap: (name, legend) => ({
			name,
			width,
			height,
			legend,
			rows: cells.map((row) => row.join("")),
		}),
	};
	return c;
}

/** sphereBand for a point given its normalised offset from a round shape's centre — the same up-left light every UI icon uses. */
export function bandAt(nx: number, ny: number): ShadeBand {
	const len = Math.hypot(nx, ny) || 1;
	return sphereBand((nx / len) * LIGHT_DIR.x + (ny / len) * LIGHT_DIR.y);
}

export interface ContentRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
