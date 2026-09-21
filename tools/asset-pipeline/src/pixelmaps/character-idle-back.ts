import type { PixelMap } from "../pixelmap.js";

// Back view of character-idle.ts's spellsword, same 24x32 silhouette and
// palette: hood/cloak dither (H/N) now covers the whole torso where the
// front view showed face and tunic, since none of that is visible from
// behind. The staff (full ring+gem+shaft down the front view's right side)
// is strapped diagonally across the back instead, so only its wood tip and a
// glint of the gem clear the shoulder line — "edge-on." Boots and legs are
// unchanged; they read the same from either side at this resolution.
export const characterIdleBack: PixelMap = {
	name: "character_idle_back",
	width: 24,
	height: 32,
	legend: {
		H: 31, // cool shadow blue-gray — cloak/hood base (half of the navy dither)
		N: 0, // darkest brown — cloak/hood dither partner
		h: 28, // steel gray — hood cap fleck
		O: 0, // darkest brown — outline: torso/cloak seams, boots
		e: 2, // dark red-brown — leather base (shoulder pad, hood trim)
		b: 5, // burnt orange-brown — leather highlight (belt, wraps all the way around)
		P: 3, // dark olive — pants base
		p: 0, // darkest brown — pants shadow
		j: 33, // bright amethyst — staff gem, glinting just above the shoulder
		w: 10, // orange-brown — staff wood shaft, edge-on
	},
	rows: [
		"........................",
		"........................",
		"........................",
		".........HHhhHH.........",
		".......HHHHHHHHHH.......",
		".....HNHNHNHNHNHNHN.....",
		".....NHNHNHNHNHNHNH.....",
		".....HNHNHNHNHNHNHN.j...",
		".....NHNHNHNHNHNHNH.w...",
		".....HHHNHNHNHNHNeNHw...",
		".....HHNHNHNHNHNHNHN....",
		".....HHHNHNHNHNHNHH.....",
		".....HHNHNHNHNHNHHH.....",
		".....HHHNHNHNHNHNHH.....",
		".....HHNHNHNHNHNHHH.....",
		".....HHHNHNHNHNHNHH.....",
		".....HHNHNHNHNHNHHH.....",
		".....HHHNHNHNHNHNHH.....",
		"........HHHNHNHH........",
		"..OHOeeebHNHNHNHNHO.....",
		"..ONOeeeHNHNHNHNHNO.....",
		"..OHOHNHNHNHNHNHNHO.....",
		"..ONONHNHNHNHNHNHNO.....",
		"..OHOHNHNHNHNHNHNHO.....",
		"..ONONHNHNHNHNHNHNO.....",
		"..OHObbbbbbbbbbbbbO.....",
		"..HNONHNHNHNHNHNHNO.....",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		"......OOOOOOOOOOOO......",
	],
};
