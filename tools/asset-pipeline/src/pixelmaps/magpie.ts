import type { PixelMap } from "../pixelmap.js";

// Magpie (leaked secrets): a pied bird with a teal-blue wing flash, carrying
// a stolen gold coin in its beak — the "shiny thing it shouldn't have" is the
// whole joke. Side view facing left, so WorldScene's orbit flips it with its
// travel direction. idle1 lifts the wing a row and flicks the tail.
const LEGEND = {
	O: 0, // ink brown — outline / black cap
	k: 31, // cool slate — black plumage (pure ink would swallow the outline)
	w: 29, // bone white — belly and shoulder patch
	u: 53, // bright blue — wing flash
	t: 46, // teal — wing shadow
	n: 60, // dark steel — beak and legs
	g: 54, // warm yellow — coin
	c: 38, // gold — coin rim
	e: 27, // cream — eye glint
};

export const magpieIdle0: PixelMap = {
	name: "magpie_idle0",
	width: 22,
	height: 18,
	legend: LEGEND,
	rows: [
		"......................",
		"....OOOO..............",
		"...OkkkkO.............",
		"..OkeOkkkO............",
		"OnnnkkkkkkO...........",
		".OOcOkkkkkkO..........",
		".OcgcOkkkkkkOO........",
		".OcgcOwwkuuuukkOOOO...",
		"..OcOwwwkuuuuuukkkkOOO",
		"...OwwwwwkutttuukkkkkO",
		"...OwwwwwwkttttukOOOO.",
		"...OwwwwwwwkuuukkO....",
		"....OwwwwwwwkkkkO.....",
		".....OwwwwwwkkOO......",
		"......OOOwwkkO........",
		"........OOOOO.........",
		"........On.On.........",
		".......OnnOnnO........",
	],
};

export const magpieIdle1: PixelMap = {
	name: "magpie_idle1",
	width: 22,
	height: 18,
	legend: LEGEND,
	rows: [
		"......................",
		"....OOOO..............",
		"...OkkkkO.............",
		"..OkeOkkkO.......OO...",
		"OnnnkkkkkkO..OOOOuuO..",
		".OOcOkkkkkkOOuuuuutO..",
		".OcgcOkkkkkkuuuutttO..",
		".OcgcOwwkkuuutttkkOOOO",
		"..OcOwwwkkkkkkkkkkkkkO",
		"...OwwwwwkkkkkkkkOOOO.",
		"...OwwwwwwkkkkkkO.....",
		"...OwwwwwwwkkkkkO.....",
		"....OwwwwwwwkkkkO.....",
		".....OwwwwwwkkOO......",
		"......OOOwwkkO........",
		"........OOOOO.........",
		"........On.On.........",
		".......OnnOnnO........",
	],
};
