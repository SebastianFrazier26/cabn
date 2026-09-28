import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 44;
const HEIGHT = 48;
const CX = 22;
const HANDLE_BOTTOM = 10;
const BUCKLE_TOP = 24;
const BUCKLE_BOTTOM = 30;

/**
 * Bag tool icon — a satchel with an arched carry handle + bronze buckle.
 * v3: scaled ~2x with a fourth leather tone (a thin highlight rim along the
 * lit edge, not just three flat fields) and stitch ticks along the seam —
 * the kind of small detail key.png/cabinet.png both carry that v2's flat
 * three-tone fill didn't have room for at half this resolution.
 */
export function buildBagIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline
		D: 2, // dark leather — shadow side
		M: 5, // mid leather
		L: 8, // light leather
		H: 13, // brightest leather — thin highlight rim on the lit edge
		g: 21, // gold buckle
		h: 0, // buckle hole (reuses ink)
		t: 26, // parchment-shade tan — stitch ticks
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 2, 40, 2);
	placeFlowerFleck(rows, 32, 42, 2);
	return { name: "ui_icon_bag", width: WIDTH, height: HEIGHT, legend, rows };
}

function halfWidthAt(y: number): number {
	if (y < 14) return 13 + (y - HANDLE_BOTTOM) * 0.6; // shoulders, widening from the handle base
	if (y < 40) return 16; // main belly, constant
	return Math.max(0, 16 - (y - 39) * 3.6); // rounded bottom
}

function pixelAt(x: number, y: number): string {
	const handle = handleChar(x, y);
	if (handle) return handle;
	if (y <= HANDLE_BOTTOM) return "."; // headroom above the shoulders for the handle arch

	const hw = halfWidthAt(y);
	const dx = x - CX;
	if (Math.abs(dx) > hw) return ".";
	if (Math.abs(dx) > hw - 1) return "O";
	// Stitch ticks: short dark dashes just inside the outline, spaced evenly —
	// a deliberate repeating mark, not noise, so it doesn't reintroduce the
	// "textured/patchy" complaint the wood/parchment pass got.
	if (Math.abs(dx) > hw - 3 && Math.floor(y / 3) % 2 === 0) return "t";
	if (Math.abs(dx) > hw - 4) return "H"; // thin highlight rim, lit side reads brighter overall

	if (y >= BUCKLE_TOP && y <= BUCKLE_BOTTOM) {
		if (y === BUCKLE_TOP || y === BUCKLE_BOTTOM) return "O";
		if (Math.abs(dx) < 2) return "h"; // buckle hole
		return "g";
	}

	return dx < 0 ? "L" : y < 20 ? "M" : "D";
}

/** A simple rectangular loop, like a satchel's carry handle: a top bar and two side posts. */
function handleChar(x: number, y: number): string | null {
	if (y > HANDLE_BOTTOM) return null;
	const dx = x - CX;
	const postOffset = 9;
	if (y === 0 && Math.abs(dx) <= postOffset) return "O"; // top bar
	if (y === 1 && Math.abs(dx) <= postOffset) return "H"; // top bar highlight, just inside the outline
	if (Math.abs(Math.abs(dx) - postOffset) < 1.4) return "O"; // two side posts
	return null;
}
