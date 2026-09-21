import type { PixelMap } from "../pixelmap.js";

// v4: cozy spellsword — rounded, low-profile hood (was a pointed peak) with
// a slouchy asymmetric droop on one side; navy cloak and warm orange tunic
// (both dithered two-tone for a woven texture) replace v3's steel-dominant
// look, which read as a spacesuit rather than knightwear; leather (not
// steel) for the knightly touches (shoulder pad, bracer, hood trim); a
// wizard's staff (wood + steel ring + purple gem) replaces the hip sword.
// Arm structure (narrow, outline-separated from the torso) is unchanged
// from v3 — that part wasn't the complaint.
export const characterIdle: PixelMap = {
	name: "character_idle",
	width: 24,
	height: 32,
	legend: {
		H: 31, // cool shadow blue-gray — cloak/hood base (half of the navy dither)
		N: 0, // darkest brown — cloak/hood dither partner (navy reads as a dark woven blue-black)
		h: 28, // steel gray — hood cap fleck (sole "knightly" metal accent, kept small)
		f: 24, // light tan — skin
		c: 16, // tan — skin shadow (cheeks, hands)
		O: 0, // darkest brown — outline: eyes, boots, arm/torso seams
		m: 2, // dark red-brown — mouth line
		g: 30, // pale ghost blue — glow accent (hood clasp), ties to the portal rune
		e: 2, // dark red-brown — leather base (shoulder pad, hood trim, bracer)
		b: 5, // burnt orange-brown — leather highlight (belt)
		t: 13, // orange — tunic base (half of the orange dither)
		u: 20, // light orange — tunic highlight (other half of the dither)
		p: 3, // dark olive — pants base
		P: 0, // darkest brown — pants shadow
		S: 28, // steel gray — staff ring
		q: 32, // deep plum — staff ring socket, either side of the gem
		j: 33, // bright amethyst — staff gem
		w: 10, // orange-brown — staff wood shaft
	},
	rows: [
		"........................",
		"........................",
		"........................",
		".........HHhhHH.........",
		".......HHHHHHHHHH.......",
		".....HNHNHNHNHNHNHN.....",
		".....NHNHNHNHNHNHNH.....",
		".....HNHNHNHNHNHNHN.....",
		".....NHNHNHNHNHNHNH.....",
		".....HHcccccccccceNH....",
		".....HHccccccccccNHN....",
		".....HHccffffffccHH.OSO.",
		".....HHccffffffccHH.qjq.",
		".....HHccOOffOOccHH.OSO.",
		".....HHccffffffccHH..w..",
		".....HHccffffffccHH..w..",
		".....HHccfmmmmfccHH..w..",
		".....HHccffffffccHH..w..",
		"........HHfggfHH.....w..",
		"..OHOeeebtututuHNHO.Nw..",
		"..ONOeeeHutututNHNO.Hw..",
		"..OHOHNHNtututuHNHO.Nw..",
		"..ONONHNHutututNHNO.Hw..",
		"..OHOHNHNtututuHNHO.ew..",
		"..ONONHNHutututNHNO.Hw..",
		"..OHObbbbbbbbbbbbbO.Nw..",
		"..ccONHNHutututNHNO.cc..",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		".......Pppp..pppP.......",
		"......OOOOOOOOOOOO......",
	],
};
