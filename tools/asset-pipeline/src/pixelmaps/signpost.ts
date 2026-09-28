import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

// The wooden signpost that stands beside an arch for every .seyn sign: an
// arrow-ended board of three planks on a single post, carved "writing"
// dashes, brass nail heads, a moss tuft at the foot. Same 24x32 grid and 2
// screen px per cell as the player and the guide NPC so it stands at a
// believable height beside them; the ink outline is derived from the
// silhouette afterwards, the same rule the guide NPC uses.

export const SIGNPOST_WIDTH = 24;
export const SIGNPOST_HEIGHT = 32;

const LEGEND: Record<string, number> = {
	O: 0, // ink outline, carved letters
	M: 61, // warm wood — plank base
	L: 63, // light wood — plank top edge
	D: 62, // dark wood — seams, post shade
	n: 21, // brass nail heads
	g: 41, // moss base
	G: 42, // moss highlight
	k: 4, // moss shadow
};

type Grid = string[][];

function blank(w: number, h: number): Grid {
	return Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
}

function paint(g: Grid, x: number, y: number, ch: string): void {
	const row = g[y];
	if (row && x >= 0 && x < row.length) row[x] = ch;
}

const BOARD_LEFT = 2;
const BOARD_RIGHT = 18;
const BOARD_TOP = 3;
const BOARD_BOTTOM = 14;
const POST_X = 10;
const POST_BOTTOM = 29;

function drawSign(g: Grid): void {
	// Post first so the board overlaps its top.
	for (let y = BOARD_BOTTOM - 1; y <= POST_BOTTOM; y++) {
		paint(g, POST_X, y, "M");
		paint(g, POST_X + 1, y, "M");
		paint(g, POST_X + 2, y, "D");
	}
	// Board: a rectangle whose right end narrows to an arrow tip.
	const mid = (BOARD_TOP + BOARD_BOTTOM) / 2;
	for (let y = BOARD_TOP; y <= BOARD_BOTTOM; y++) {
		const tip = Math.round(3 - Math.abs(y - mid) * 0.75);
		for (let x = BOARD_LEFT; x <= BOARD_RIGHT + Math.max(0, tip); x++) {
			const plankRow = (y - BOARD_TOP) % 4;
			paint(g, x, y, plankRow === 0 ? "L" : plankRow === 3 ? "D" : "M");
		}
	}
	for (const [x0, x1, y] of [
		[5, 9, 5],
		[11, 15, 5],
		[5, 13, 9],
		[5, 8, 13],
		[10, 14, 13],
	] as const) {
		for (let x = x0; x <= x1; x++) paint(g, x, y, "O");
	}
	for (const [x, y] of [
		[BOARD_LEFT + 1, BOARD_TOP + 1],
		[BOARD_LEFT + 1, BOARD_BOTTOM - 1],
		[BOARD_RIGHT - 1, BOARD_TOP + 1],
		[BOARD_RIGHT - 1, BOARD_BOTTOM - 1],
	] as const) {
		paint(g, x, y, "n");
	}
	for (const [x, y, ch] of [
		[7, 30, "k"],
		[8, 30, "g"],
		[8, 29, "G"],
		[9, 30, "g"],
		[13, 30, "g"],
		[14, 30, "k"],
		[14, 29, "G"],
		[15, 30, "k"],
		[9, 29, "g"],
		[13, 29, "g"],
	] as const) {
		paint(g, x, y, ch);
	}
}

function outline(g: Grid): void {
	const h = g.length;
	const w = g[0]?.length ?? 0;
	const edge: [number, number][] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (g[y]?.[x] !== ".") continue;
			const touches = [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			].some(([dx, dy]) => {
				const c = g[y + (dy as number)]?.[x + (dx as number)];
				return c !== undefined && c !== "." && c !== "O";
			});
			if (touches) edge.push([x, y]);
		}
	}
	for (const [x, y] of edge) paint(g, x, y, "O");
}

export function signpostMap(): PixelMap {
	const g = blank(SIGNPOST_WIDTH, SIGNPOST_HEIGHT);
	drawSign(g);
	outline(g);
	return {
		name: "prop_seyn_sign",
		width: SIGNPOST_WIDTH,
		height: SIGNPOST_HEIGHT,
		legend: LEGEND,
		rows: g.map((row) => row.join("")),
	};
}

/** The owner's sign item for the hotbar — the same post with the shared leaf-sprig/flower motif every item icon carries at its base. */
export function signIconMap(): PixelMap {
	const post = signpostMap();
	const rows = [...post.rows];
	placeLeafSprig(rows, 4, 31);
	placeFlowerFleck(rows, 18, 31);
	return {
		name: "ui_icon_sign",
		width: post.width,
		height: post.height,
		legend: { ...post.legend, ...LEAF_LEGEND, ...FLOWER_LEGEND },
		rows,
	};
}
