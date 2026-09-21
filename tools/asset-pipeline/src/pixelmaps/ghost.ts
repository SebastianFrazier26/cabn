import type { PixelMap } from "../pixelmap.js";

// Curvier v2: rounded dome, slight rightward tilt (lean grows with row via a
// sine ease so it reads as drifting rather than falling over), and a wavy
// 3-lobe trailing tail instead of a flat hem. Palette indices are the
// curated cool colors (28-31) appended in extract-palette.ts — the
// extracted-from-icons palette has no cool neutrals a ghost could use.
export const ghost: PixelMap = {
	name: "ghost",
	width: 32,
	height: 36,
	legend: {
		O: 31, // cool shadow blue-gray — outline, eyes, mouth
		G: 30, // pale ghost blue — rim shade
		w: 29, // bone / moonlight white — main body
	},
	rows: [
		"................O...............",
		".............OGGwGGO............",
		"...........OOGGwwwGGOO..........",
		"..........OOGGwwwwwGGOO.........",
		".........OOGGwwwwwwwGGOO........",
		"..........OGGwwwwwwwwwGGO.......",
		".........OGGwwwwwwwwwwwGGO......",
		"........OOGGwwwwwwwwwwwGGOO.....",
		"........OGGwwwwwwwwwwwwwGGO.....",
		".......OOGGwwwwwwwwwwwwwGGOO....",
		"......OOGGwwwwwwwwwwwwwwwGGOO...",
		"......OOGwwwwwwwwwwwwwwwwwGOO...",
		".....OOGGwwwwwwwwwwwwwwwwwGGOO..",
		".....OOGwwwwwwwwwwwwwwwwwwwGOO..",
		".....OOGGwwwwwwwwwwwwwwwwwGGOO..",
		".......OGGwwwwOOwwwwOOwwwwwGGO..",
		".......OOGwwwwwwwwwwwwwwwwwGOO..",
		".......OOGGwwwwwwwwwwwwwGGOO....",
		"........OGGwwwwwwOOwwwwwwwGGO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwwwwwwwwwwwwwwwGOO...",
		"........OOGwww.wwwwwww.wwwGOO...",
		"........OOGwww..wwwww..wwwGOO...",
		"........OOGww...wwwww...wwGOO...",
		".........OGww...wwwww...wwGO....",
		".........OGww....www....wwGO....",
		".........OGw.....www.....wGO....",
		"..........Gw.....www.....wG.....",
		"..........Gw......w......wG.....",
	],
};
