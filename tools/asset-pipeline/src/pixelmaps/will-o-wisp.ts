import type { PixelMap } from "../pixelmap.js";

// A small floating diamond of pale flame with a near-white hot core — pale
// blue/green (a new curated color; the existing pale-ghost-blue alone reads
// too purely blue, see extract-palette.ts). idle1's core sits one row higher
// than idle0's, a simple bob for the cosmetic drift animation FileScene gives
// wisps (see engine CHANGELOG entry).
export const willOWispIdle0: PixelMap = {
	name: "will_o_wisp_idle0",
	width: 14,
	height: 16,
	legend: {
		O: 31, // cool shadow blue-gray — outline
		f: 35, // wisp pale green — flame body
		c: 29, // bone / moonlight white — hot core
	},
	rows: [
		"..............",
		"....OOOOOO....",
		"...OffffffO...",
		"..OffffffffO..",
		".OffffffffffO.",
		".OfffccccfffO.",
		"OffffccccffffO",
		"OffffccccffffO",
		"OffffccccffffO",
		"OffffccccffffO",
		".OffffffffffO.",
		".OffffffffffO.",
		"..OffffffffO..",
		"...OffffffO...",
		"....OOOOOO....",
		"..............",
	],
};

export const willOWispIdle1: PixelMap = {
	name: "will_o_wisp_idle1",
	width: 14,
	height: 16,
	legend: {
		O: 31,
		f: 35,
		c: 29,
	},
	rows: [
		"..............",
		"....OOOOOO....",
		"...OffffffO...",
		"...OffffffO...",
		"..OffccccffO..",
		"..OffccccffO..",
		".OfffccccfffO.",
		".OfffccccfffO.",
		".OfffccccfffO.",
		".OffffffffffO.",
		"..OffffffffO..",
		"..OffffffffO..",
		"...OffffffO...",
		"...OffffffO...",
		"....OOOOOO....",
		"..............",
	],
};
