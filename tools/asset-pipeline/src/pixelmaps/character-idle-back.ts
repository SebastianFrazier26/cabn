import type { PixelMap } from "../pixelmap.js";

// Back view of character-idle.ts's spellsword, same 24x32 silhouette and
// palette. v1 of this map filled the whole hood and cloak with the front
// view's H/N (slate/dark-brown) dither — fine on the front, where the face
// and orange tunic break it up, but from behind nothing did, so in game the
// back view read as a grey checkerboard (2026-09-28 playtest). v2 keeps the
// cloak solid slate, lit from the upper left with a periwinkle rim (L)
// and only the shadow side dithered (N), closes the hood with a leather trim
// band at the neck and the cape with one at the hem, lets the orange tunic
// hem show under the cape, and keeps the staff fully visible in the same
// hand as the front view (ring + gem + shaft) rather than strapped edge-on.
export const characterIdleBack: PixelMap = {
	name: "character_idle_back",
	width: 24,
	height: 32,
	legend: {
		H: 31, // cool shadow blue-gray — cloak/hood base
		L: 37, // periwinkle — cloak fold highlight, gives the navy read without a dither
		N: 0, // darkest brown — cloak outline and shadow folds
		h: 28, // steel gray — hood cap fleck
		O: 0, // darkest brown — outline: arm seams, boots
		e: 2, // dark red-brown — leather (shoulder pad, hood trim)
		b: 5, // burnt orange-brown — belt, visible either side of the cape
		t: 13, // orange — tunic hem under the cape (half of the orange dither)
		u: 20, // light orange — tunic hem highlight
		c: 16, // tan — hands
		S: 28, // steel gray — staff ring
		q: 32, // deep plum — staff ring socket
		j: 33, // bright amethyst — staff gem
		w: 10, // orange-brown — staff wood shaft
		P: 3, // dark olive — pants base
		p: 0, // darkest brown — pants shadow
	},
	rows: [
		"........................",
		"........................",
		"........................",
		".........HHhhHH.........",
		".......HLLHHHHHHH.......",
		".....NLHHHHHHHHHNHN.....",
		".....NLHHHHHHHHHHNN.....",
		".....NLHHHHHHHHHNHN.....",
		".....NLHHHHHHHHHHNN.....",
		".....NLHHHHHHHHHNeNH....",
		".....NLHHHHHHHHHHNHN....",
		".....NLHHHHHHHHHNHN.OSO.",
		".....NLHHHHHHHHHHNN.qjq.",
		".....NLHHHHHHHHHNHN.OSO.",
		".....NLHHHHHHHHHHNN..w..",
		".....NLHHHHHHHHHNHN..w..",
		".....NLHHHHHHHHHHNN..w..",
		".....NNLHHHHHHHNHNN..w..",
		"........NeeeeeeN.....w..",
		"..OHOeeeNLHHHHHNHNO.Nw..",
		"..ONOeeeNLHHHHHHNHO.Hw..",
		"..OHONLHHHHHHHNHNHO.Nw..",
		"..ONONLHHHHHHHHNHNO.Hw..",
		"..OHONLHHHHHHHNHNHO.ew..",
		"..ONONLHHHHHHHHNHNO.Hw..",
		"..OHObbNLHHHHHNHbbO.Nw..",
		"..ccOtNeeeeeeeeeNuO.cc..",
		".......tutu..utut.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		"......OOOOOOOOOOOO......",
	],
};
