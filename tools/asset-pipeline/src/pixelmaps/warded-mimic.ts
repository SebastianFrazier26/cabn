import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Warded mimic (InvalidMode — unreadable/mislabelled file), 2026-09-28
// redraw: a gold-banded treasure chest whose lid is cracked open on a row of
// teeth, two glowing eyes peering out of the dark and a tongue lolling over
// the rim — the "file" isn't what its label says. The plum lock plate carries
// the amethyst ward rune. idle1 lifts the lid a row (a second row of eye-glow
// shows), drops the tongue lower and swaps the rune from a diamond to a cross
// so it flickers.
const LEGEND = {
	O: 0, // ink brown — outline
	W: 62, // wood dark — plank seams
	w: 61, // wood warm — planks
	L: 63, // wood light — lid highlight
	G: 18, // old gold — bands and corner caps
	Y: 38, // butter gold — band highlight
	X: 32, // deep plum — lock plate
	r: 33, // bright amethyst — ward rune
	t: 29, // bone white — teeth
	m: 2, // dark red-brown — mouth
	e: 54, // sun yellow — eyes
	p: 52, // berry pink — tongue
	P: 39, // berry red — tongue shade
};

const LID = [
	"...OOOOOOOOO",
	"..OYLLLLLLLL",
	".OYGwwWwwwww",
	".OGwwwWwwwww",
	".OGGGGGGGGGG",
	"..OOOOOOOOOO",
];

const TEETH_TOP = "..Otmmmmmtmm";
const EYES = "..Ommmmeemmm";
const MOUTH = "..Ommmmmmmmm";
const TEETH_BOTTOM = "..Ommtmmmmmt";

const BASE = (runePhase: 0 | 1) => [
	".OYYYYYYYYYY",
	".OGwwWwwwwww",
	".OGwwWwwOOOO",
	runePhase ? ".OGwwWwwOXrX" : ".OGwwWwwOXXr",
	runePhase ? ".OGwwWwwOrrr" : ".OGwwWwwOXrX",
	runePhase ? ".OGwwWwwOXrX" : ".OGwwWwwOXXr",
	".OGwwWwwOOOO",
	".OGGGGGGGGGG",
	"..OOOOOOOOOO",
];

export const wardedMimicIdle0: PixelMap = {
	name: "warded_mimic_idle0",
	width: 24,
	height: 20,
	legend: LEGEND,
	rows: overlay(
		mirrored([
			"............",
			...LID,
			TEETH_TOP,
			EYES,
			EYES,
			TEETH_BOTTOM,
			...BASE(0),
		]),
		14,
		10,
		["pp..", "OpPO", ".OpO", "..O."],
	),
};

export const wardedMimicIdle1: PixelMap = {
	name: "warded_mimic_idle1",
	width: 24,
	height: 20,
	legend: LEGEND,
	rows: overlay(
		mirrored([...LID, TEETH_TOP, EYES, EYES, MOUTH, TEETH_BOTTOM, ...BASE(1)]),
		14,
		10,
		["pp..", "OpPO", ".OpO", ".OpO", "..O."],
	),
};
