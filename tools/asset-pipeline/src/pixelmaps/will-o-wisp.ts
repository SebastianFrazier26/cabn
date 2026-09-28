import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Will-o'-wisp (TODO/FIXME notes — cosmetic, never fought), 2026-09-28
// redraw: a little lantern-glow spirit flame — sky-blue tongues around a warm
// cream core with a sleepy face — with the TODO it stands for pinned to it as
// a paper scrap. Outlined in deep navy rather than ink so it reads as light,
// not a solid body. idle1 flickers the tongues (the centre one ducks, the
// side ones leap) and flutters the note.
const LEGEND = {
	O: 67, // deep navy — outline
	b: 53, // sky blue — outer flame
	c: 68, // cyan — mid flame
	p: 30, // pale ghost blue — inner flame
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
