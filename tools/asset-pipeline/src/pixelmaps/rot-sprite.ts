import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Rot-sprite (Corrupted — unparseable config), 2026-09-28 redraw: a glossy
// teal slime gone queasy, dripping at the base, with magenta corruption
// blotches, stray glitch pixels floating off it and one scanline torn a
// pixel sideways — "the data inside it is garbled". Teal rather than the
// bramble's leaf green so the two round blobs stay distinct. idle1 squashes
// a row (the dome drops one row onto a fixed base), tears a different line and
// scatters the glitch bits.
const LEGEND = {
	O: 0, // ink brown — outline, eyes, mouth
	d: 43, // grove shadow — deepest underside
	G: 46, // glade shadow — body shade
	g: 47, // glade base — body
	l: 48, // glade highlight — upper body
	h: 29, // bone white — gloss
	w: 29, // bone white — eye glint
	x: 52, // berry pink — corruption
	X: 32, // deep plum — corruption core
	b: 37, // cornflower — glitch pixels
};

const BODY = mirrored([
	"...........",
	"...........",
	"........OOO",
	"......OOlll",
	".....Ollggg",
	"....Olhlggg",
	"...Olhhgggg",
	"...OlhggOgg",
	"..OlgggOwOg",
	"..OggggOOOg",
	".OGgggggOgg",
	".OGgggggggg",
	"OGGgggggOgO",
	"OGGggggggOg",
	"OGGGggggggg",
	"OdGGGGGGGGG",
	".OOOOOOOOOO",
	"...........",
]);

const BLOTCH = ["xX", "Xx", "x."];
const BLOTCH_LOW = ["Xx", "xb"];
const DRIPS_LEFT = ["OGO", ".O."];
const DRIPS_RIGHT = ["OdO", "OdO"];

/** Shifts everything right of `fromX` on row `y` one cell further right — the torn-scanline glitch. */
function tear(rows: string[], y: number, fromX: number): string[] {
	return rows.map((r, i) =>
		i === y ? `${r.slice(0, fromX)}${r[fromX] ?? "."}${r.slice(fromX, -1)}` : r,
	);
}

function squash(rows: string[]): string[] {
	const out = [...rows];
	out.splice(6, 1);
	out.unshift(".".repeat(out[0]?.length ?? 0));
	return out;
}

export const rotSpriteIdle0: PixelMap = {
	name: "rot_sprite_idle0",
	width: 22,
	height: 18,
	legend: LEGEND,
	rows: overlay(
		overlay(
			overlay(
				overlay(overlay(tear(BODY, 11, 11), 14, 6, BLOTCH), 4, 12, BLOTCH_LOW),
				3,
				16,
				DRIPS_LEFT,
			),
			15,
			16,
			DRIPS_RIGHT,
		),
		15,
		0,
		["b...x", "..b..", "...x."],
	),
};

export const rotSpriteIdle1: PixelMap = {
	name: "rot_sprite_idle1",
	width: 22,
	height: 18,
	legend: LEGEND,
	rows: overlay(
		overlay(
			overlay(
				overlay(
					overlay(tear(squash(BODY), 14, 12), 14, 7, BLOTCH),
					4,
					13,
					BLOTCH_LOW,
				),
				3,
				16,
				DRIPS_LEFT,
			),
			15,
			16,
			DRIPS_RIGHT,
		),
		14,
		0,
		["..x..b", "b.....", "....b."],
	),
};
