import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

// The owner's toolkit item: a quartered crest under a small gold crown,
// with a brass key down its middle. Same 24x32 grid, legend style, derived
// ink outline and base motif as the sign item (signpost.ts), so the two
// owner items read as one set on the hotbar.

const WIDTH = 24;
const HEIGHT = 32;
const CX = 12;
const SHIELD_TOP = 5;
const SHIELD_SHOULDER = 16;
const SHIELD_BOTTOM = 27;
const SHIELD_HALF = 8.5;

const LEGEND: Record<string, number> = {
	O: 0, // ink outline
	R: 55, // crest red
	r: 57, // crest red shadow
	B: 53, // crest blue
	b: 37, // crest blue shadow
	g: 21, // brass rim
	G: 25, // bright gold
	k: 12, // bronze shade
	...LEAF_LEGEND,
	...FLOWER_LEGEND,
};

function shieldHalfWidth(y: number): number {
	if (y < SHIELD_TOP || y > SHIELD_BOTTOM) return -1;
	if (y <= SHIELD_SHOULDER) return SHIELD_HALF;
	const t = (y - SHIELD_SHOULDER) / (SHIELD_BOTTOM - SHIELD_SHOULDER + 0.6);
	return SHIELD_HALF * Math.sqrt(Math.max(0, 1 - t * t));
}

function inShield(x: number, y: number): boolean {
	const half = shieldHalfWidth(y);
	return half > 0 && Math.abs(x + 0.5 - CX) <= half;
}

function onShieldEdge(x: number, y: number): boolean {
	return (
		inShield(x, y) &&
		(!inShield(x - 1, y) ||
			!inShield(x + 1, y) ||
			!inShield(x, y - 1) ||
			!inShield(x, y + 1))
	);
}

function keyCell(x: number, y: number): string | null {
	const dx = x + 0.5 - CX;
	const dy = y + 0.5 - 11;
	const d = Math.hypot(dx, dy);
	if (d <= 3.1 && d >= 1.3) return dx + dy < 0 ? "G" : "k";
	if (y >= 14 && y <= 23 && (x === CX - 1 || x === CX))
		return x === CX - 1 ? "G" : "k";
	if ((y === 19 || y === 21) && x >= CX + 1 && x <= CX + 2) return "G";
	return null;
}

function crownCell(x: number, y: number): string | null {
	if (y === 4 && x >= CX - 5 && x <= CX + 4) return "g";
	if (y === 3 && x >= CX - 5 && x <= CX + 4) return "G";
	const points = [CX - 5, CX - 1, CX, CX + 4];
	if (y === 2 && points.includes(x)) return "G";
	if (y === 1 && (x === CX - 5 || x === CX + 4 || x === CX - 1 || x === CX))
		return x === CX - 1 || x === CX ? "R" : "G";
	return null;
}

function cell(x: number, y: number): string {
	const crown = crownCell(x, y);
	if (crown) return crown;
	if (!inShield(x, y)) return ".";
	if (onShieldEdge(x, y)) return "g";
	const key = keyCell(x, y);
	if (key) return key;
	// Gold on the quartered field blurs once softened; an ink ring keeps the key.
	if (
		keyCell(x - 1, y) ||
		keyCell(x + 1, y) ||
		keyCell(x, y - 1) ||
		keyCell(x, y + 1)
	)
		return "O";
	const left = x < CX;
	const top = y < 15;
	const red = left === top;
	// Lit from the upper left, like every item icon: the right third shades.
	const shade = x + 0.5 - CX > SHIELD_HALF * 0.35;
	if (red) return shade ? "r" : "R";
	return shade ? "b" : "B";
}

function outline(rows: string[][]): void {
	const edge: [number, number][] = [];
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			if (rows[y]?.[x] !== ".") continue;
			const touches = [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			].some(([dx, dy]) => {
				const c = rows[y + (dy as number)]?.[x + (dx as number)];
				return c !== undefined && c !== "." && c !== "O";
			});
			if (touches) edge.push([x, y]);
		}
	}
	for (const [x, y] of edge) {
		const row = rows[y];
		if (row) row[x] = "O";
	}
}

export function ownerIconMap(): PixelMap {
	const grid = Array.from({ length: HEIGHT }, (_, y) =>
		Array.from({ length: WIDTH }, (_, x) => cell(x, y)),
	);
	outline(grid);
	const rows = grid.map((row) => row.join(""));
	placeLeafSprig(rows, 4, 31);
	placeFlowerFleck(rows, 18, 31);
	return {
		name: "ui_icon_owner",
		width: WIDTH,
		height: HEIGHT,
		legend: LEGEND,
		rows,
	};
}
