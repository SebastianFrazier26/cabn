import type { PixelMap } from "../pixelmap.js";

// A small locked chest: wood body, steel bands top/bottom, a keyhole lock
// plate, and a glowing rune (amethyst — reuses the staff-gem purple, no new
// color needed). idle1's rune cells use a different phase of the same
// checkerboard pattern so the glyph appears to flicker between frames.
export const wardedMimicIdle0: PixelMap = {
	name: "warded_mimic_idle0",
	width: 22,
	height: 20,
	legend: {
		O: 0, // ink brown — outline
		W: 2, // dark wood — body
		w: 5, // lighter wood — lid / trim
		M: 28, // steel gray — bands and lock plate
		k: 0, // ink — keyhole slot
		r: 33, // bright amethyst — rune glow
	},
	rows: [
		"....OOOOOOOOOOOOOO....",
		"..OOwwwwwwwwwwwwwwOO..",
		".OwwwwwwwwwwwwwwwwwwO.",
		"OwwwwwwwwwwwwwwwwwwwwO",
		"OwwwwwwwwwwwwwwwwwwwwO",
		"OWWWWWWWWWWWWWWWWWWWWO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OWWWWWWWWWWWWWWWWWWWWO",
		"OWWWWWWWWMMMMWWWWWWWWO",
		"OWWWWWWWWMkkMWWWWWWWWO",
		"OWWWWWWWWMMMMWWWWWWWWO",
		"OWWWWWWWWWWWWWWWWWWWWO",
		"OWWWWWWWwrwwrwWWWWWWWO",
		"OWWWWWWWrwwrwwWWWWWWWO",
		"OWWWWWWWwwrwwrWWWWWWWO",
		"OWWWWWWWwrwwrwWWWWWWWO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OOOOOOOOOOOOOOOOOOOOOO",
	],
};

export const wardedMimicIdle1: PixelMap = {
	name: "warded_mimic_idle1",
	width: 22,
	height: 20,
	legend: {
		O: 0,
		W: 2,
		w: 5,
		M: 28,
		k: 0,
		r: 33,
	},
	rows: [
		"....OOOOOOOOOOOOOO....",
		".OOOwwwwwwwwwwwwwwOOO.",
		"OwwwwwwwwwwwwwwwwwwwwO",
		"OwwwwwwwwwwwwwwwwwwwwO",
		"OWWWWWWWWWWWWWWWWWWWWO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OWWWWWWWWWWWWWWWWWWWWO",
		"OWWWWWWWWMMMMWWWWWWWWO",
		"OWWWWWWWWMkkMWWWWWWWWO",
		"OWWWWWWWWMMMMWWWWWWWWO",
		"OWWWWWWWWWWWWWWWWWWWWO",
		"OWWWWWWWrwwrwwWWWWWWWO",
		"OWWWWWWWwwrwwrWWWWWWWO",
		"OWWWWWWWwrwwrwWWWWWWWO",
		"OWWWWWWWrwwrwwWWWWWWWO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OMMMMMMMMMMMMMMMMMMMMO",
		"OOOOOOOOOOOOOOOOOOOOOO",
	],
};
