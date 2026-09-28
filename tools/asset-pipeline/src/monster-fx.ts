import type { RGB } from "./color.js";
import {
	createGrid,
	type Grid,
	outlineGrid,
	setPixel,
	toPixelMap,
} from "./pixel-shapes.js";
import type { PixelMap } from "./pixelmap.js";

// Battle frames derived from each species' idle0 rather than hand-drawn per
// species: 11 species x 4 frames of bespoke art would drift in style, and a
// flash/poof is the same gesture for every monster. Every derived frame
// keeps idle0's exact grid size, so a sprite fitted once with
// fitSpriteToSize() never jumps in size when the engine swaps textures.

const INK = 0;
const HIT_OUTLINE = 55; // mushroom red bright
const PUFF = { light: 29, fill: 58, shade: 59, rim: 60 } as const;
const SPARK = { core: 65, glow: 54 } as const;

export function pixelMapToGrid(map: PixelMap): Grid {
	const grid = createGrid(map.width, map.height);
	map.rows.forEach((row, y) => {
		[...row].forEach((ch, x) => {
			if (ch === ".") return;
			const idx = map.legend[ch];
			if (idx !== undefined) setPixel(grid, x, y, idx);
		});
	});
	return grid;
}

function nearestIndex(palette: readonly RGB[], c: RGB): number {
	let best = 0;
	let bestD = Number.POSITIVE_INFINITY;
	palette.forEach((p, i) => {
		const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	});
	return best;
}

function lighten(palette: readonly RGB[], idx: number, t: number): number {
	const c = palette[idx];
	if (!c) return idx;
	return nearestIndex(palette, {
		r: c.r + (255 - c.r) * t,
		g: c.g + (255 - c.g) * t,
		b: c.b + (255 - c.b) * t,
	});
}

/** The species' own outline index — whatever idle0 maps 'O' to (ink for most, cool blue-gray for ghost, navy for the wisp). */
function outlineIndex(map: PixelMap): number {
	return map.legend.O ?? INK;
}

function hash(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

function contentBox(grid: Grid): Box {
	let x0 = Number.POSITIVE_INFINITY;
	let y0 = Number.POSITIVE_INFINITY;
	let x1 = -1;
	let y1 = -1;
	grid.forEach((row, y) => {
		row.forEach((v, x) => {
			if (v == null) return;
			x0 = Math.min(x0, x);
			y0 = Math.min(y0, y);
			x1 = Math.max(x1, x);
			y1 = Math.max(y1, y);
		});
	});
	return { x0, y0, x1, y1 };
}

/** One recoil/flash frame: body tones bleached most of the way to white, outline turned hot red. */
export function hitFrame(
	map: PixelMap,
	palette: readonly RGB[],
	name: string,
): PixelMap {
	const outline = outlineIndex(map);
	const grid = pixelMapToGrid(map).map((row) =>
		row.map((v) =>
			v == null ? null : v === outline ? HIT_OUTLINE : lighten(palette, v, 0.6),
		),
	);
	return toPixelMap(name, grid);
}

/** A shaded puff: a filled disc lit from the up-left (the shared light direction), no outline — outlineGrid adds it once all puffs are placed. */
function puff(grid: Grid, cx: number, cy: number, r: number): void {
	for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
		for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
			const dx = x + 0.5 - cx;
			const dy = y + 0.5 - cy;
			const d = Math.hypot(dx, dy);
			if (d > r) continue;
			const lit = (-dx - dy) / (Math.max(d, 0.01) * Math.SQRT2);
			const tone =
				d > r * 0.55 && lit > 0.3
					? PUFF.light
					: d > r * 0.6 && lit < -0.3
						? PUFF.shade
						: PUFF.fill;
			setPixel(grid, x, y, tone);
		}
	}
}

function sparkle(grid: Grid, x: number, y: number, big: boolean): void {
	setPixel(grid, x, y, SPARK.core);
	if (!big) return;
	setPixel(grid, x - 1, y, SPARK.glow);
	setPixel(grid, x + 1, y, SPARK.glow);
	setPixel(grid, x, y - 1, SPARK.glow);
	setPixel(grid, x, y + 1, SPARK.glow);
}

function finishPuffs(grid: Grid): void {
	outlineGrid(grid, PUFF.rim);
}

/**
 * Three-frame defeat "poof": (0) the monster bleaching and breaking up with
 * the first puffs bursting at its edges, (1) a full cloud over where it
 * stood, (2) the cloud scattering into small puffs and sparkles. Sparkles
 * are stamped after the puff outline so they stay free-floating points.
 */
export function defeatFrames(
	map: PixelMap,
	palette: readonly RGB[],
	baseName: string,
): [PixelMap, PixelMap, PixelMap] {
	const src = pixelMapToGrid(map);
	const box = contentBox(src);
	const cx = (box.x0 + box.x1 + 1) / 2;
	const cy = (box.y0 + box.y1 + 1) / 2;
	const bw = box.x1 - box.x0 + 1;
	const bh = box.y1 - box.y0 + 1;
	const span = Math.min(bw, bh);
	const w = map.width;
	const h = map.height;

	const f0 = createGrid(w, h);
	src.forEach((row, y) => {
		row.forEach((v, x) => {
			if (v == null || hash(x, y, 1) < 0.3) return;
			setPixel(f0, x, y, lighten(palette, v, 0.35));
		});
	});
	const r0 = Math.max(1.6, span * 0.14);
	const burst = createGrid(w, h);
	puff(burst, box.x0 + r0 * 0.6, cy + bh * 0.2, r0);
	puff(burst, box.x1 + 1 - r0 * 0.6, cy + bh * 0.1, r0);
	puff(burst, cx - bw * 0.15, box.y0 + r0 * 0.7, r0 * 0.9);
	puff(burst, cx + bw * 0.2, box.y1 + 1 - r0 * 0.7, r0 * 0.9);
	finishPuffs(burst);
	overlayGrid(f0, burst);

	const f1 = createGrid(w, h);
	const r1 = Math.max(2.2, span * 0.26);
	puff(f1, cx, cy + r1 * 0.2, r1 * 1.1);
	puff(f1, cx - r1 * 0.9, cy + r1 * 0.35, r1 * 0.8);
	puff(f1, cx + r1 * 0.9, cy + r1 * 0.3, r1 * 0.85);
	puff(f1, cx - r1 * 0.35, cy - r1 * 0.55, r1 * 0.75);
	puff(f1, cx + r1 * 0.45, cy - r1 * 0.45, r1 * 0.7);
	finishPuffs(f1);
	sparkle(f1, Math.round(box.x0 + 1), Math.round(box.y0 + 1), true);
	sparkle(f1, Math.round(box.x1 - 1), Math.round(box.y0 + 2), false);
	sparkle(f1, Math.round(box.x1 - 1), Math.round(box.y1 - 1), true);

	const f2 = createGrid(w, h);
	const r2 = Math.max(1.2, span * 0.12);
	const spread = span * 0.36;
	for (let i = 0; i < 5; i++) {
		const a = -Math.PI / 2 + (i * Math.PI * 2) / 5 + 0.3;
		puff(f2, cx + Math.cos(a) * spread, cy + Math.sin(a) * spread, r2);
	}
	finishPuffs(f2);
	sparkle(f2, Math.round(cx), Math.round(cy), true);
	sparkle(f2, Math.round(box.x0), Math.round(cy - spread * 0.4), false);
	sparkle(f2, Math.round(box.x1), Math.round(cy + spread * 0.5), false);

	return [
		toPixelMap(`${baseName}0`, f0),
		toPixelMap(`${baseName}1`, f1),
		toPixelMap(`${baseName}2`, f2),
	];
}

function overlayGrid(dest: Grid, src: Grid): void {
	src.forEach((row, y) => {
		row.forEach((v, x) => {
			if (v != null) setPixel(dest, x, y, v);
		});
	});
}
