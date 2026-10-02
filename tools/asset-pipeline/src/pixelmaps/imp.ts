import type { PixelMap } from "../pixelmap.js";
import { mirrored, overlay } from "./mirror.js";

// Hex Imp (syntax errors): a plum/amethyst imp with cream horns, clutching a
// crackling gold hex-spark — purple rather than the gremlin's orange so the
// two small horned things never read as the same species. idle1 flicks the
// spade tail up a row and turns the spark from a plus into an x.
const LEGEND = {
	O: 0, // ink brown — outline
	B: 32, // deep plum — body shade
	b: 33, // bright amethyst — body
	h: 27, // cream — horns
	e: 54, // warm yellow — eyes
	w: 29, // bone white — eye glint
	m: 52, // rose — grin
	s: 38, // gold — hex spark
};

const BODY = mirrored([
	"..........",
	"...h......",
	"...hh.....",
	"....hhOOOO",
	"....OBBBBB",
	"...OBbbbbb",
	"OO.OBbbbbb",
	"OBOOBbbbbb",
	".OBBbeewbb",
	"..OBbeeebb",
	"...OBbbbbb",
	"...OBbbbmm",
	"....OBBbbb",
	".....OOBBB",
	"....OBBbbb",
	"...OBOBbbb",
	"...OO.OBbb",
	"......OBbb",
	"......OBBO",
	".....OBBO.",
	".....OOO..",
]);

const SPARK_PLUS = ["..s..", ".sws.", "sw.ws", ".sws.", "..s.."];
const SPARK_X = ["s...s", ".sws.", "..w..", ".sws.", "s...s"];

export const impIdle0: PixelMap = {
	name: "imp_idle0",
	width: 20,
	height: 21,
	legend: LEGEND,
	rows: overlay(overlay(BODY, 0, 12, SPARK_PLUS), 15, 13, [
		"..OO.",
		".ObbO",
		"..OBO",
		".OO..",
		"O....",
	]),
};

export const impIdle1: PixelMap = {
	name: "imp_idle1",
	width: 20,
	height: 21,
	legend: LEGEND,
	rows: overlay(overlay(BODY, 0, 11, SPARK_X), 15, 12, [
		"..OO.",
		".ObbO",
		"..OBO",
		"..O..",
		".O...",
		"O....",
	]),
};
