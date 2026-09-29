import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Will-o'-wisp (TODO/FIXME notes — cosmetic, never fought), 2026-09-28
// redraw: a little lantern-glow spirit flame — pale moonlit tongues around a
// warm cream core with a sleepy face — with the TODO it stands for pinned to
// it as a paper scrap. Outlined in deep navy rather than ink so it reads as
// light, not a solid body. idle1 flickers the tongues (the centre one ducks,
// the side ones leap) and flutters the note. Art polish 2 (same day): the
// flame was sky blue and cyan, which the night grade (a blue-violet multiply)
// all but erased; its tones are now the palest blue/green/white, which the
// grade can darken but never lose against the grass.
const LEGEND = {
	O: 67, // deep navy — outline
	b: 30, // pale ghost blue — outer flame
	c: 35, // wisp pale green — mid flame
	p: 29, // bone white — inner flame
	w: 65, // lantern glow — core
	k: 67, // deep navy — eyes, mouth
	n: 27, // cream — note paper
	l: 60, // stone dark — note writing
};

const TIPS_0 = [
	"........",
	".......O",
	"......Ob",
	"......Ob",
	"..O..Obc",
	"..ObOObc",
	"..Obbbcc",
];

const TIPS_1 = [
	"........",
	"........",
	"..O.....",
	"..OO...O",
	"..ObO.Ob",
	"..ObbObc",
	"..Obbbcc",
];

const FLAME = [
	"..Obccpp",
	".Obccppw",
	".Obcpwww",
	"Obcpwwww",
	"Obcpwkww",
	"Obcpwkww",
	"Obcpwwww",
	".Obcpwwk",
	"..Obcppp",
	"...Obccc",
	"....OObb",
	"......OO",
	"........",
];

export const willOWispIdle0: PixelMap = {
	name: "will_o_wisp_idle0",
	width: 16,
	height: 20,
	legend: LEGEND,
	rows: overlay(mirrored([...TIPS_0, ...FLAME]), 11, 15, [
		"OOOOO",
		"OnnnO",
		"OlllO",
		"OnnnO",
		"OOOOO",
	]),
};

export const willOWispIdle1: PixelMap = {
	name: "will_o_wisp_idle1",
	width: 16,
	height: 20,
	legend: LEGEND,
	rows: overlay(mirrored([...TIPS_1, ...FLAME]), 11, 14, [
		".OOOO",
		"OnnnO",
		"OlllO",
		"OnnnO",
		"OOOO.",
	]),
};
