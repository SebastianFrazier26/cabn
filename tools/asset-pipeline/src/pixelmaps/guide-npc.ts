import type { PixelMap } from "../pixelmap.js";

// Wren, the guide who stands by the first world's bonfire: a cottagecore
// herbalist in a wide straw sun hat (green band, pink flower), auburn hair
// with a braid over one shoulder, a moss shawl with a fringed hem, a russet
// skirt under a cream apron, a plum field guide tucked under one arm and a
// brass lantern hanging from the other hand. Same 24x32 grid and 2 screen px
// per cell as character-idle, so she stands exactly as tall as the player.
//
// Authored as colour spans painted in order rather than 32 hand-typed rows:
// the frames only differ in a handful of cells (the lantern flame and a
// blink), and spans keep those cells named instead of hunting for them in a
// row string. The ink outline is derived afterwards from the silhouette,
// the same rule outlineGrid() applies to the world-art props.

export const GUIDE_NPC_WIDTH = 24;
export const GUIDE_NPC_HEIGHT = 32;
export const GUIDE_NPC_FRAME_COUNT = 3;

const LEGEND: Record<string, number> = {
	O: 0, // darkest brown — outline, eyes
	h: 26, // straw hat
	H: 27, // straw highlight
	s: 22, // brim underside shade
	G: 44, // hat band
	p: 52, // flower petals
	y: 54, // flower centre
	r: 57, // auburn hair
	R: 2, // hair shadow, mouth
	f: 24, // skin
	c: 16, // skin shade, hands
	b: 36, // blush
	w: 27, // blouse
	g: 45, // shawl
	k: 44, // shawl shade
	d: 43, // shawl fringe
	v: 32, // book cover
	V: 33, // book spine highlight
	P: 27, // book pages
	t: 37, // periwinkle skirt
	T: 31, // skirt folds
	a: 27, // apron
	A: 22, // apron shade, pocket
	L: 60, // lantern iron
	l: 28, // lantern frame
	q: 65, // lantern glass glow
	Q: 54, // flame core
	x: 62, // boots
};

type Span = readonly [x0: number, x1: number, char: string];

// "E" (eyes) and "1"/"2" (the two flame cells) are per-frame placeholders,
// resolved by frameChars() below.
const SPANS: Readonly<Record<number, readonly Span[]>> = {
	2: [
		[10, 13, "h"],
		[16, 16, "p"],
	],
	3: [
		[9, 14, "h"],
		[10, 11, "H"],
		[15, 15, "p"],
		[16, 16, "y"],
		[17, 17, "p"],
	],
	4: [
		[9, 14, "G"],
		[16, 16, "p"],
	],
	5: [
		[4, 19, "h"],
		[6, 9, "H"],
	],
	6: [[3, 20, "s"]],
	7: [
		[7, 8, "r"],
		[9, 14, "c"],
		[15, 16, "r"],
	],
	8: [
		[7, 8, "r"],
		[9, 14, "f"],
		[10, 10, "E"],
		[13, 13, "E"],
		[15, 16, "r"],
	],
	9: [
		[7, 8, "r"],
		[9, 14, "f"],
		[9, 9, "b"],
		[14, 14, "b"],
		[15, 16, "r"],
	],
	10: [
		[7, 8, "r"],
		[9, 14, "f"],
		[11, 12, "R"],
		[15, 16, "r"],
	],
	11: [
		[7, 7, "r"],
		[8, 8, "R"],
		[9, 9, "c"],
		[10, 13, "f"],
		[14, 14, "c"],
		[15, 15, "R"],
		[16, 16, "r"],
	],
	12: [
		[6, 7, "r"],
		[8, 9, "R"],
		[10, 13, "c"],
		[14, 15, "R"],
		[16, 17, "r"],
	],
	13: [
		[5, 5, "r"],
		[6, 6, "k"],
		[7, 10, "g"],
		[11, 12, "w"],
		[13, 16, "g"],
		[17, 17, "k"],
	],
	14: [
		[5, 5, "r"],
		[6, 6, "k"],
		[7, 10, "g"],
		[11, 12, "w"],
		[13, 16, "g"],
		[17, 18, "k"],
	],
	15: [
		[2, 7, "v"],
		[8, 10, "g"],
		[11, 12, "w"],
		[13, 16, "g"],
		[17, 18, "k"],
	],
	16: [
		[2, 2, "v"],
		[3, 6, "P"],
		[7, 7, "V"],
		[8, 8, "c"],
		[9, 9, "k"],
		[10, 10, "d"],
		[11, 12, "w"],
		[13, 13, "d"],
		[14, 14, "k"],
		[15, 15, "d"],
		[16, 17, "k"],
		[18, 18, "c"],
	],
	17: [
		[2, 2, "v"],
		[3, 6, "P"],
		[7, 7, "V"],
		[8, 16, "t"],
		[10, 13, "a"],
		[16, 16, "T"],
		[19, 20, "c"],
	],
	18: [
		[2, 7, "v"],
		[8, 16, "t"],
		[10, 13, "a"],
		[13, 13, "A"],
		[16, 16, "T"],
		[19, 22, "L"],
	],
	19: [
		[7, 16, "t"],
		[10, 13, "a"],
		[13, 13, "A"],
		[16, 16, "T"],
		[19, 19, "l"],
		[20, 21, "q"],
		[22, 22, "l"],
	],
	20: [
		[7, 17, "t"],
		[9, 14, "a"],
		[10, 11, "A"],
		[14, 14, "A"],
		[17, 17, "T"],
		[19, 19, "l"],
		[20, 20, "1"],
		[21, 21, "2"],
		[22, 22, "l"],
	],
	21: [
		[7, 17, "t"],
		[9, 14, "a"],
		[10, 11, "A"],
		[14, 14, "A"],
		[17, 17, "T"],
		[19, 19, "l"],
		[20, 21, "q"],
		[22, 22, "l"],
	],
	22: [
		[7, 17, "t"],
		[9, 14, "a"],
		[14, 14, "A"],
		[17, 17, "T"],
		[19, 22, "L"],
	],
	23: [
		[6, 17, "t"],
		[9, 14, "a"],
		[14, 14, "A"],
		[17, 17, "T"],
		[20, 21, "L"],
	],
	24: [
		[6, 17, "t"],
		[9, 14, "A"],
		[17, 17, "T"],
	],
	25: [
		[6, 17, "t"],
		[6, 6, "T"],
		[9, 9, "T"],
		[15, 15, "T"],
		[17, 17, "T"],
	],
	26: [
		[6, 17, "t"],
		[6, 6, "T"],
		[9, 9, "T"],
		[15, 15, "T"],
		[17, 17, "T"],
	],
	27: [
		[6, 17, "t"],
		[6, 6, "T"],
		[9, 9, "T"],
		[15, 15, "T"],
		[17, 17, "T"],
	],
	28: [[6, 17, "T"]],
	29: [
		[8, 10, "x"],
		[13, 15, "x"],
	],
	30: [
		[7, 10, "x"],
		[13, 16, "x"],
	],
};

/** Frame 0 rests, frame 1 flickers the flame to the other cell, frame 2 blinks. */
function frameChars(frame: number): Record<string, string> {
	return {
		E: frame === 2 ? "c" : "O",
		"1": frame === 1 ? "q" : "Q",
		"2": frame === 1 ? "Q" : "q",
	};
}

function withOutline(rows: string[][]): void {
	const filled = (x: number, y: number) => (rows[y]?.[x] ?? ".") !== ".";
	const edge: [number, number][] = [];
	for (let y = 0; y < rows.length; y++) {
		const row = rows[y] ?? [];
		for (let x = 0; x < row.length; x++) {
			if (row[x] !== ".") continue;
			if (
				filled(x - 1, y) ||
				filled(x + 1, y) ||
				filled(x, y - 1) ||
				filled(x, y + 1)
			) {
				edge.push([x, y]);
			}
		}
	}
	for (const [x, y] of edge) {
		const row = rows[y];
		if (row) row[x] = "O";
	}
}

export function guideNpcFrame(frame: number): PixelMap {
	const rows = Array.from({ length: GUIDE_NPC_HEIGHT }, () =>
		new Array<string>(GUIDE_NPC_WIDTH).fill("."),
	);
	const resolve = frameChars(frame);
	for (const [yKey, spans] of Object.entries(SPANS)) {
		const row = rows[Number(yKey)];
		if (!row) continue;
		for (const [x0, x1, char] of spans) {
			for (let x = x0; x <= x1; x++) row[x] = resolve[char] ?? char;
		}
	}
	withOutline(rows);
	return {
		name: `npc_guide_f${frame}`,
		width: GUIDE_NPC_WIDTH,
		height: GUIDE_NPC_HEIGHT,
		legend: LEGEND,
		rows: rows.map((r) => r.join("")),
	};
}

/** The "!" speech bubble shown over the guide until the player first talks to her. */
export const guideNpcBubble: PixelMap = {
	name: "npc_guide_bubble",
	width: 7,
	height: 10,
	legend: { O: 0, w: 29, "!": 55 },
	rows: [
		".OOOOO.",
		"OwwwwwO",
		"Oww!wwO",
		"Oww!wwO",
		"Oww!wwO",
		"OwwwwwO",
		"Oww!wwO",
		"OwwwwwO",
		".OOwOO.",
		"...O...",
	],
};

/** Head-and-shoulders crop of frame 0 for the dialogue box portrait, in grid cells (outline included). */
export const GUIDE_NPC_PORTRAIT_CROP = { x: 4, y: 1, w: 16, h: 14 } as const;
