import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 22;
const HEIGHT = 26;
const CX = 10.5;
const CY = 9;
const RADIUS = 9;
const STAND_TOP = 19;

/** Crystal orb tool icon — a swirling violet/cyan glass sphere on a small bronze stand. */
export function buildCrystalOrbIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink rim
		P: 32, // plum — outer glass
		A: 33, // amethyst — swirl band
		G: 30, // pale ghost blue — core glow
		W: 29, // cream — specular glint
		b: 17, // bronze — stand highlight
		B: 2, // dark bronze/wood — stand shadow
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 2, 22);
	placeFlowerFleck(rows, 15, 23);
	return { name: "ui_icon_orb", width: WIDTH, height: HEIGHT, legend, rows };
}

function pixelAt(x: number, y: number): string {
	if (y >= STAND_TOP) return standChar(x, y);
	const dx = x - CX;
	const dy = y - CY;
	const dist = Math.hypot(dx, dy);
	if (dist > RADIUS) return ".";
	if (dist > RADIUS - 1) return "O";
	// Specular highlight sits up-and-left of center, same light direction every
	// other icon in this file uses — one consistent "light source" across the set.
	if (Math.hypot(dx + 3, dy + 3.5) < 2.2) return "W";
	if (dist < 2.4) return "G";
	const angle = Math.atan2(dy, dx);
	const swirl = Math.sin(dist * 0.9 + angle * 1.6);
	return swirl > 0.15 ? "A" : "P";
}

function standChar(x: number, y: number): string {
	const row = y - STAND_TOP;
	const halfWidth = 3 + row * 0.9;
	const left = Math.round(CX - halfWidth);
	const right = Math.round(CX + halfWidth);
	if (x < left || x > right) return ".";
	if (x === left || x === right || row === 0) return "O";
	return row < 3 ? "b" : "B";
}
