import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Bramble (code smells / complexity): a tangled ball of vine with thorns
// poking out, two grumpy gold eyes and a single red berry. The dark-green
// interior strokes are the "tangle" — knotted like an over-nested function.
// idle1 curls the loose tendrils the other way and swaps which thorns poke.
const LEGEND = {
	O: 0, // ink brown — outline
	g: 40, // mid green — vine
	l: 41, // light green — sunlit vine
	G: 43, // deep green — tangle strokes
	t: 61, // warm brown — thorns
	e: 38, // gold — eyes
	k: 0, // ink — pupils
	r: 39, // brick red — berry
	h: 36, // blush — berry glint
};

const BODY = mirrored([
	"..........",
	".....t....",
	"....tOOOOO",
	"..tOOllggg",
	"...OlllgGg",
	"..OlggGggg",
	".tOlgGgggG",
	"..OggGeekg",
	".OggGgeekg",
	"tOgGgggggg",
	".OGggGGggg",
	".OgggggGGg",
	"tOGggGggGg",
	".OgGGgggGg",
	"..OgggGggg",
	"..tOggGggg",
	"...OOgggGg",
	".....OOOOO",
	"..........",
	"..........",
]);

export const brambleIdle0: PixelMap = {
	name: "bramble_idle0",
	width: 20,
	height: 20,
	legend: LEGEND,
	rows: overlay(overlay(BODY, 13, 3, [".OO.", "OrrO", "OrhO", ".OO."]), 2, 16, [
		"Gg...",
		".Gg..",
		"..GgG",
	]),
};

export const brambleIdle1: PixelMap = {
	name: "bramble_idle1",
	width: 20,
	height: 20,
	legend: LEGEND,
	rows: overlay(
		overlay(overlay(BODY, 13, 3, [".OO.", "OrrO", "OrhO", ".OO."]), 14, 16, [
			"GgG..",
			"..gG.",
			"...G.",
		]),
		0,
		0,
		["....t...............", "t...................", "...................t"],
	),
};
