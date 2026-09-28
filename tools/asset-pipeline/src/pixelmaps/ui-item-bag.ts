import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 22;
const HEIGHT = 24;
const CX = 11;
const HANDLE_BOTTOM = 5;
const BUCKLE_TOP = 13;
const BUCKLE_BOTTOM = 16;

/**
 * Bag tool icon — a satchel with an arched carry handle, not the tapered
 * "hood" shape v1 drew (which read as a cloak, not a bag — a handle loop is
 * the one silhouette detail that unambiguously says "carried container").
 */
export function buildBagIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline
		D: 2, // dark leather — shadow side
		M: 5, // mid leather
		L: 8, // light leather — highlight side
		g: 21, // gold buckle
		h: 0, // buckle hole (reuses ink)
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 1, 20);
	placeFlowerFleck(rows, 16, 21);
	return { name: "ui_icon_bag", width: WIDTH, height: HEIGHT, legend, rows };
}

function halfWidthAt(y: number): number {
	if (y < 7) return 6.5 + (y - HANDLE_BOTTOM) * 0.3; // shoulders, widening from the handle base
	if (y < 20) return 8; // main belly, constant
	return Math.max(0, 8 - (y - 19) * 1.8); // rounded bottom
}

function pixelAt(x: number, y: number): string {
	const handle = handleChar(x, y);
	if (handle) return handle;
	if (y <= HANDLE_BOTTOM) return "."; // headroom above the shoulders for the handle arch

	const hw = halfWidthAt(y);
	const dx = x - CX;
	if (Math.abs(dx) > hw) return ".";
	if (Math.abs(dx) > hw - 1 || y === HEIGHT - 1) return "O";

	if (y >= BUCKLE_TOP && y <= BUCKLE_BOTTOM) {
		if (y === BUCKLE_TOP || y === BUCKLE_BOTTOM) return "O";
		if (Math.abs(dx) < 1.2) return "h"; // buckle hole
		return "g";
	}

	return dx < 0 ? "L" : y < 10 ? "M" : "D";
}

/** A simple rectangular loop, like a satchel's carry handle: a top bar and two side posts. */
function handleChar(x: number, y: number): string | null {
	if (y > HANDLE_BOTTOM) return null;
	const dx = x - CX;
	const postOffset = 4.5;
	if (y === 0 && Math.abs(dx) <= postOffset) return "O"; // top bar
	if (Math.abs(Math.abs(dx) - postOffset) < 0.8) return "O"; // two side posts
	return null;
}
