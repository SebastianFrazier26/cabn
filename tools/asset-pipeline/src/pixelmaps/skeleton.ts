import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Skeleton (dead code), deliberately cottagecore rather than grim: a
// round-skulled little bone critter with big soft eyes, rosy cheeks and a
// pink flower tucked behind one ear, outlined in warm brown instead of ink so
// it reads as dusty-cute, not spooky. idle1 tilts the flower and lifts one
// stubby arm in a wave.
const LEGEND = {
	O: 62, // warm brown — outline (softer than ink)
	b: 27, // cream — bone
	s: 23, // pale khaki — bone shade
	e: 0, // ink — eye sockets
	w: 29, // bone white — eye glint
	p: 36, // blush pink — cheeks and petals
	y: 54, // warm yellow — flower heart
	l: 41, // leaf green — flower leaf
};

const BODY = mirrored([
	".........",
	".........",
	"....OOOOO",
	"...Obbbbb",
	"..Obbbbbb",
	".Obbbbbbb",
	".Obbbbbbb",
	"Obbeeebbb",
	"Obbewebbb",
	"Obbeeebbb",
	"Obppbbbbb",
	".Obbbbbbe",
	"..Osbbbbb",
	"...OsbObO",
	"....OOOOO",
	".......Ob",
	"..OO.OObb",
	".ObsOObOO",
	"..OOOObbb",
	".....ObOO",
	".....Obbb",
	"....ObOOO",
	"....OO...",
]);

export const skeletonIdle0: PixelMap = {
	name: "skeleton_idle0",
	width: 18,
	height: 23,
	legend: LEGEND,
	rows: overlay(BODY, 11, 0, [".pp.", "pyyp", ".ppl", "..ll"]),
};

export const skeletonIdle1: PixelMap = {
	name: "skeleton_idle1",
	width: 18,
	height: 23,
	legend: LEGEND,
	rows: overlay(
		overlay(BODY, 12, 0, ["pp..", "yyp.", "ppl.", ".l.."]),
		14,
		13,
		["...OO", "..ObO", ".ObO.", "OO...", "....."],
	),
};
