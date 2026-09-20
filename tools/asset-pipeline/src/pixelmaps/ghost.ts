import type { PixelMap } from "../pixelmap.js";

export const ghost: PixelMap = {
	name: "ghost",
	width: 32,
	height: 32,
	legend: {
		O: 0, // darkest brown — outline, eyes, mouth
		G: 23, // warm gray — shaded rim
		w: 27, // palest cream — main body
	},
	rows: [
		"................................",
		".............OGGGGO.............",
		"..........OGGGwwwwGGGO..........",
		"........OGGGwwwwwwwwGGGO........",
		".......OGGGwwwwwwwwwwGGGO.......",
		"......OGGGwwwwwwwwwwwwGGGO......",
		".....OGGGwwwwwwwwwwwwwwGGGO.....",
		".....OGGGwwwwwwwwwwwwwwGGGO.....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwOOwwwwwwOOwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwOOOOwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....OGGGwwwwwwwwwwwwwwwwGGGO....",
		"....GGGGGGGwGGGwGGGwGGGwGGGO....",
		"................................",
		"................................",
		"................................",
	],
};
