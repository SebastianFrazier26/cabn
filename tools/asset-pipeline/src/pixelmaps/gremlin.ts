import type { PixelMap } from "../pixelmap.js";

// A squat, round-eared imp — warm orange-brown skin (existing extracted
// tones), ember-red eyes (new, see extract-palette.ts CURATED_COLORS) since
// nothing warm-but-glowing existed for "mischief" already. idle1 shifts the
// ear/eye/mouth rows up by one for a quick twitch, not a walk cycle.
export const gremlinIdle0: PixelMap = {
	name: "gremlin_idle0",
	width: 18,
	height: 20,
	legend: {
		O: 0, // ink brown — outline
		S: 8, // orange-brown — body
		s: 13, // lighter orange-brown — belly/chest shading
		e: 34, // ember red — eyes
		t: 27, // cream — teeth
	},
	rows: [
		".....OOOOOOOO.....",
		"....OSSSSSSSSO....",
		"...OSSSSSSSSSSO...",
		"..OSSSSSSSSSSSSO..",
		"O.OSSSSSSSSSSSSO.O",
		"OOSSssssssssssSSOO",
		".OSSssssssssssSSO.",
		".OSSssssssssssSSO.",
		"OSSSssssssssssSSSO",
		"OSSSSeeSSSSeeSSSSO",
		"OSSSSeeSSSSeeSSSSO",
		"OSSSSSSSSSSSSSSSSO",
		"OSSSSSSSSSSSSSSSSO",
		"OSSSSSttttttSSSSSO",
		".OSSSSSSSSSSSSSSO.",
		".OSSSSSSSSSSSSSSO.",
		"..OSSSSSSSSSSSSO..",
		"..OSSSSSSSSSSSSO..",
		"...OSSSSSSSSSSO...",
		"...OOOOOOOOOOOO...",
	],
};

export const gremlinIdle1: PixelMap = {
	name: "gremlin_idle1",
	width: 18,
	height: 20,
	legend: {
		O: 0,
		S: 8,
		s: 13,
		e: 34,
		t: 27,
	},
	rows: [
		".....OOOOOOOO.....",
		"....OSSSSSSSSO....",
		"...OSSSSSSSSSSO...",
		"O.OSSSSSSSSSSSSO.O",
		"OOSSssssssssssSSOO",
		".OSSssssssssssSSO.",
		".OSSssssssssssSSO.",
		"OSSSssssssssssSSSO",
		"OSSSSeeSSSSeeSSSSO",
		"OSSSSeeSSSSeeSSSSO",
		"OSSSSSSSSSSSSSSSSO",
		"OSSSSSSSSSSSSSSSSO",
		"OSSSSSttttttSSSSSO",
		".OSSSSSSSSSSSSSSO.",
		".OSSSSSSSSSSSSSSO.",
		"..OSSSSSSSSSSSSO..",
		"..OSSSSSSSSSSSSO..",
		"...OSSSSSSSSSSO...",
		"...OSSSSSSSSSSO...",
		"...OOOOOOOOOOOO...",
	],
};
