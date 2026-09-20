import type { PixelMap } from "../pixelmap.js";

// v2: Pokémon Black/White overworld proportions — oversized head (~18 of 32
// rows), short torso, stubby legs — rather than the more naturalistic v1.
// More shading tones per garment (base/shadow/highlight) than v1 so soften()
// has luminance variance to react to.
export const characterIdle: PixelMap = {
	name: "character_idle",
	width: 24,
	height: 32,
	legend: {
		H: 2, // dark red-brown — hair shadow (crown)
		h: 8, // orange-brown — hair base
		f: 24, // light tan — skin base
		c: 16, // tan — skin shadow (cheeks, brow band, hands)
		O: 0, // darkest brown — eyes, boots
		m: 2, // dark red-brown — mouth line
		T: 4, // dark green — tunic shadow (sides, arms)
		t: 9, // mid green — tunic base
		i: 11, // light green — tunic highlight (chest)
		b: 5, // burnt orange-brown — belt
		p: 3, // dark olive — pants base
		P: 0, // darkest brown — pants shadow
	},
	rows: [
		"........................",
		"........................",
		"........HHHHHHHH........",
		"........HHHHHHHH........",
		".....HHhhhhhhhhhhHH.....",
		".....HHhhhhhhhhhhHH.....",
		".....HHhhhhhhhhhhHH.....",
		".....HHhhhhhhhhhhHH.....",
		".....hhhhhhhhhhhhhh.....",
		".....hcccccccccccch.....",
		"......cccccccccccc......",
		"......ccffffffffcc......",
		"......ccffffffffcc......",
		"......ccfOOffOOfcc......",
		"......ccffffffffcc......",
		"......ccffffffffcc......",
		"......ccffmmmmffcc......",
		"......ccffffffffcc......",
		"........TTffffTT........",
		"........TTffffTT........",
		"...TTTTTttiiiittTTTTT...",
		"...TTTTTttiiiittTTTTT...",
		"...TTTTTttiiiittTTTTT...",
		"...TTTTTttiiiittTTTTT...",
		"...TTbbbbbbbbbbbbbbTT...",
		"...TTTTTttiiiittTTTTT...",
		"...cc..............cc...",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		"......OOOOOOOOOOOO......",
	],
};
