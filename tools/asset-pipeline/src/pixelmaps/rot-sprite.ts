import type { PixelMap } from "../pixelmap.js";

// A rounded slime blob in the extracted sickly-olive greens (no new colors
// needed) — two frames are a simple squish-down "breathe" bob (idle1 is one
// row shorter/wider than idle0), not a walk cycle.
export const rotSpriteIdle0: PixelMap = {
	name: "rot_sprite_idle0",
	width: 20,
	height: 14,
	legend: {
		O: 1, // dark green — outline
		G: 6, // mid olive green — upper body
		g: 9, // lighter olive green — lower body
		h: 27, // cream — sheen highlight
		e: 0, // ink — eyes
	},
	rows: [
		"......OOOOOOOO......",
		"....OOGGGGGGGGOO....",
		"...OGGGGGGGGGGGGO...",
		"..OGGGhhhhGGGGGGGO..",
		"..OGGGhhhhGGGGGGGO..",
		".OGGGGhhhhGGGGGGGGO.",
		".OGGGGGeeGGGeeGGGGO.",
		".OGGGGGeeGGGeeGGGGO.",
		"OGGGGGGGGGGGGGGGGGGO",
		"OGGGGGGGGGGGGGGGGGGO",
		"OggggggggggggggggggO",
		"OggggggggggggggggggO",
		".OggggggggggggggggO.",
		".OOOOOOOOOOOOOOOOOO.",
	],
};

export const rotSpriteIdle1: PixelMap = {
	name: "rot_sprite_idle1",
	width: 20,
	height: 13,
	legend: {
		O: 1,
		G: 6,
		g: 9,
		h: 27,
		e: 0,
	},
	rows: [
		".....OOOOOOOOOO.....",
		"....OGGGGGGGGGGO....",
		"...OGGhhhhGGGGGGO...",
		"..OGGGhhhhGGGGGGGO..",
		".OGGGGhhhhGGGGGGGGO.",
		".OGGGGGeeGGGeeGGGGO.",
		"OGGGGGGeeGGGeeGGGGGO",
		"OGGGGGGGGGGGGGGGGGGO",
		"OGGGGGGGGGGGGGGGGGGO",
		"OggggggggggggggggggO",
		".OggggggggggggggggO.",
		".OggggggggggggggggO.",
		"..OOOOOOOOOOOOOOOO..",
	],
};
