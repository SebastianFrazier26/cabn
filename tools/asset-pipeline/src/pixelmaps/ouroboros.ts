import {
	createGrid,
	type Grid,
	setPixel,
	toPixelMap,
} from "../pixel-shapes.js";
import type { PixelMap } from "../pixelmap.js";

// Ouroboros (circular imports), 2026-09-28 redraw: a sapphire serpent coiled
// into a ring, its head at twelve o'clock with jaws clamped on its own
// tapering tail — the old version was a banded annulus that read as a donut.
// Generated rather than hand-typed because a clean ring with a smooth taper,
// a lit/shaded tube and a belly stripe is exactly what ASCII rows get wrong.
// 36x36 (not the old 48) so its cells land at roughly the other species'
// on-screen density at its larger MONSTER_HOVER_SIZE. idle1 slides the gold
// back diamonds half a step along the body, so the spin WorldScene gives it
// reads as the scales travelling.
const SIZE = 36;
const INK = 0;
const TONE = {
	shade: 67, // deep navy
	base: 66, // sapphire
	light: 53, // sky blue
	belly: 51, // sand highlight
	bellyShade: 26, // pale wheat
	diamond: 38, // butter gold
	mouth: 2, // dark red-brown
	fang: 29, // bone white
	eye: 54, // sun yellow
	pupil: 0,
};

const CX = SIZE / 2;
const CY = SIZE / 2 + 0.5;
const RING_R = 11.5;
/** Screen angle of the neck (atan2, y down, so increasing angle runs clockwise); the tail comes back round to meet it. */
const NECK_ANGLE = -Math.PI / 2 - 0.3;
const DIAMONDS = 12;

function halfWidth(s: number): number {
	return 3.4 - 1.9 * s;
}

/** 0 at the neck, 1 at the tail tip, running clockwise. */
function bodyParam(x: number, y: number): { s: number; r: number } {
	const dx = x + 0.5 - CX;
	const dy = y + 0.5 - CY;
	let a = Math.atan2(dy, dx) - NECK_ANGLE;
	while (a < 0) a += Math.PI * 2;
	while (a >= Math.PI * 2) a -= Math.PI * 2;
	return { s: a / (Math.PI * 2), r: Math.hypot(dx, dy) };
}

function paintBody(
	grid: Grid,
	phase: number,
	keep: (s: number) => boolean,
): void {
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const { s, r } = bodyParam(x, y);
			if (!keep(s)) continue;
			const h = halfWidth(s);
			// u: -1 on the inner edge (belly) .. +1 on the outer edge (back).
			const u = (r - RING_R) / h;
			if (Math.abs(u) > 1) continue;
			const dx = x + 0.5 - CX;
			const dy = y + 0.5 - CY;
			// Lit from the up-left like every other sprite: outer-edge cells whose
			// outward normal faces up-left catch light, the rest fall to shade.
			const facing = (-dx - dy) / (Math.hypot(dx, dy) * Math.SQRT2);
			let tone: number;
			if (u < -0.3) tone = facing < -0.2 ? TONE.bellyShade : TONE.belly;
			else if (u > 0.55) tone = facing > 0.35 ? TONE.light : TONE.shade;
			else tone = facing > 0.55 ? TONE.light : TONE.base;
			const along = (s * DIAMONDS + phase) % 1;
			if (
				h > 1.8 &&
				Math.abs(along - 0.5) < 0.13 &&
				Math.abs(u - 0.25) < 0.35
			) {
				tone = TONE.diamond;
			}
			setPixel(grid, x, y, tone);
		}
	}
}

function outlineOutside(grid: Grid): void {
	const filled = (x: number, y: number) => grid[y]?.[x] != null;
	const edge: [number, number][] = [];
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			if (filled(x, y)) continue;
			if (
				filled(x - 1, y) ||
				filled(x + 1, y) ||
				filled(x, y - 1) ||
				filled(x, y + 1)
			)
				edge.push([x, y]);
		}
	}
	for (const [x, y] of edge) setPixel(grid, x, y, INK);
}

// Profile head facing left (back toward the incoming tail), jaws open. 'm'
// cells are the mouth: the tail shows through them where it passes, which is
// the whole point of the sprite.
const HEAD = [
	"....OOOOOO..",
	"..OOlllllbO.",
	".OllllbbbbbO",
	"OlllbbbewbbO",
	"ObbbbbbkkbbO",
	"OOOOOtbbbbdO",
	"mmmmmmOObddO",
	"mmmmmmmObddO",
	"OOOOtOObbddO",
	".OddddddddO.",
	"..OOOOOOOO..",
];
const HEAD_X = 10;
const HEAD_Y = 2;
const HEAD_TONE: Record<string, number> = {
	O: INK,
	l: TONE.light,
	b: TONE.base,
	d: TONE.shade,
	t: TONE.fang,
	e: TONE.pupil,
	w: TONE.eye,
	k: TONE.pupil,
	m: TONE.mouth,
};

function frame(name: string, phase: number): PixelMap {
	const grid = createGrid(SIZE, SIZE);
	paintBody(grid, phase, (s) => s < 0.985);
	HEAD.forEach((row, dy) => {
		[...row].forEach((ch, dx) => {
			if (ch === ".") return;
			const x = HEAD_X + dx;
			const y = HEAD_Y + dy;
			const { s } = bodyParam(x, y);
			if (ch === "m" && s > 0.5 && grid[y]?.[x] != null) return;
			setPixel(grid, x, y, HEAD_TONE[ch] ?? INK);
		});
	});
	outlineOutside(grid);
	return toPixelMap(name, grid);
}

export const ouroborosIdle0: PixelMap = frame("ouroboros_idle0", 0);
export const ouroborosIdle1: PixelMap = frame("ouroboros_idle1", 0.5);
