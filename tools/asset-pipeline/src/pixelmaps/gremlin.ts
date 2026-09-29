import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Gremlin (IoError — unbalanced brackets/strings), 2026-09-28 redraw: a
// bat-eared tangerine goblin with a fanged grin, brandishing the steel "["
// it pried out of the file. Orange rather than the imp's plum so the two
// small mischief-makers never read as one species. idle1 flicks the ears
// up, cuts its eyes toward the bracket and hefts it a row higher.
const LEGEND = {
	O: 0, // ink brown — outline, brows, mouth line
	S: 57, // autumn orange dark — body shade
	s: 56, // autumn orange — body
	h: 25, // warm apricot — head highlight
	c: 24, // wheat — belly (kept under soften's bloom threshold)
	p: 36, // blush — inner ears
	e: 54, // sun yellow — eyes
	k: 0, // ink — pupils
	t: 29, // bone white — fangs
	m: 2, // dark red-brown — mouth
	M: 58, // stone light — bracket
	D: 60, // stone dark — bracket shade
};

const EARS_DOWN = [
	"...........",
	"...........",
	"OO.........",
	"OpO....OOOO",
	"OppOOOOshhh",
	".OppOSsshhh",
	".OpppSsssss",
	"..OOSsOOsss",
];

const EARS_UP = [
	"...........",
	"O..........",
	"OpO........",
	"OppO...OOOO",
	".OppOOOshhh",
	".OpppOsshhh",
	"..OppSsssss",
	"...OSsOOsss",
];

const FACE_AND_BODY = [
	"...OSsssOOs",
	"...OSsekess",
	"...OSseeess",
	"...OSssOsss",
	"...OSsssOOO",
	"....OSsOtmt",
	".....OSOOOO",
	"....OSscccc",
	"....OSscccc",
	".....OSSccc",
	".....OSsO..",
	".....OOOO..",
];

const RAISED_ARM = ["OO..", "OsO.", ".OsO", "..Os"];

const BRACKET = [
	".OOOO",
	".OMMO",
	".OMOO",
	"OsMD.",
	"sOMD.",
	".OMOO",
	".ODDO",
	".OOOO",
];

export const gremlinIdle0: PixelMap = {
	name: "gremlin_idle0",
	width: 22,
	height: 20,
	legend: LEGEND,
	rows: overlay(
		overlay(mirrored([...EARS_DOWN, ...FACE_AND_BODY]), 1, 13, RAISED_ARM),
		16,
		11,
		BRACKET,
	),
};

export const gremlinIdle1: PixelMap = {
	name: "gremlin_idle1",
	width: 22,
	height: 20,
	legend: LEGEND,
	rows: overlay(
		overlay(
			overlay(mirrored([...EARS_UP, ...FACE_AND_BODY]), 7, 9, ["eek..eek"]),
			1,
			12,
			RAISED_ARM,
		),
		16,
		10,
		BRACKET,
	),
};
