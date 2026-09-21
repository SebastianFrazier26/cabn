import type { PixelMap } from "../pixelmap.js";

// v3: "spellsword" restyle — hood + cloak over a light-armor chest, short
// sword at the hip, two glowing-blue accents (hood clasp, sword pommel)
// using the same curated pale-ghost-blue as the portal rune, tying the
// character to the portal set. Arms are a narrow 1px-shadow + 1px-base
// column, separated from the torso by an outline seam on both sides —
// v2's arms read as "wide" because they shared a color with the torso's
// side-shading and visually fused into one block.
export const characterIdle: PixelMap = {
	name: "character_idle",
	width: 24,
	height: 32,
	legend: {
		H: 31, // cool shadow blue-gray — hood, cloak, sleeves
		h: 30, // pale ghost blue — hood peak highlight
		f: 24, // light tan — skin
		c: 16, // tan — skin shadow (cheeks, hands)
		O: 0, // darkest brown — outline: eyes, boots, arm/torso seams
		m: 2, // dark red-brown — mouth line
		g: 30, // pale ghost blue — glow accents (hood clasp, sword pommel)
		a: 28, // steel gray — light armor, base
		A: 23, // warm gray — light armor, highlight band
		b: 5, // burnt orange-brown — belt
		e: 5, // burnt orange-brown — sword grip
		S: 28, // steel gray — sword blade
		p: 3, // dark olive — pants base
		P: 0, // darkest brown — pants shadow
	},
	rows: [
		"........................",
		"........................",
		"..........HHHH..........",
		"..........HhhH..........",
		"........HHHHHHHH........",
		"........HHHHHHHH........",
		".....HHHHHHHHHHHHHH.....",
		".....HHHHHHHHHHHHHH.....",
		".....HHHHHHHHHHHHHH.....",
		".....HHccccccccccHH.....",
		".....HHccccccccccHH.....",
		".....HHccffffffccHH.....",
		".....HHccffffffccHH.....",
		".....HHccOOffOOccHH.....",
		".....HHccffffffccHH.....",
		".....HHccffffffccHH.....",
		".....HHccfmmmmfccHH.....",
		".....HHccffffffccHH.....",
		"........HHfggfHH........",
		"........HHffffHH....g...",
		"..OHOHHHHaaaaaaHHHOOgO..",
		"..OHOHHHHaaaaaaHHHOOSO..",
		"..OHOHHHHaaaaaaHHHOOSO..",
		"..OHOHHHHAAAAAAHHHOOSO..",
		"..OHOHHHHaaaaaaHHHOOSO..",
		"..OHObbbbbbbbbbbbbOeee..",
		"..ccOHHHHaaaaaaHHHOeee..",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		"......OOOOOOOOOOOO......",
	],
};
