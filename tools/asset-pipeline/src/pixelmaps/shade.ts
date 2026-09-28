import type { PixelMap } from "../pixelmap.js";
import { mirrored } from "./mirror.js";

// Shade (catch-all / external linter findings): the ghost's dark cousin — a
// plum-slate hooded shadow with two pale-green pinprick eyes and a tattered
// hem. Generic on purpose: it has to stand in for any finding without a
// species of its own, and is the engine's fallback sprite for unknown
// species. idle1 swaps the hem's tatters and narrows the eyes.
const LEGEND = {
	O: 0, // ink brown — outline
	d: 32, // deep plum — body
	D: 31, // cool slate — rim light
	e: 35, // wisp pale green — eyes
};

const TOP = [
	".........",
	"......OOO",
	"....OODDd",
	"...ODDddd",
	"..ODDdddd",
	"..ODddddd",
	".ODdddddd",
	".ODdddddd",
	".ODddeedd",
	".ODddeedd",
	"ODDdddddd",
];

const HEM0 = [
	"ODdddddd",
	"ODdddddd",
	"ODdddddd",
	"Oddddddd",
	"Oddddddd",
	"OdddOddd",
	"Odd.Oddd",
	"Od...Odd",
	"O.....Od",
];

const HEM1 = [
	"ODdddddd",
	"ODdddddd",
	"ODdddddd",
	"Oddddddd",
	"Oddddddd",
	"Oddddddd",
	".OddOddd",
	"..Od.Odd",
	"...O..Od",
];

function body(eyesNarrow: boolean, hem: readonly string[]): string[] {
	const top = TOP.map((r, i) => (eyesNarrow && i === 8 ? ".ODdddddd" : r));
	// Hem rows are 8-wide halves with the centre pixel folded in, so the
	// mirrored hem's centre notch lines up under the hood's centre.
	return mirrored([...top, ...hem.map((r) => `${r}d`)]);
}

export const shadeIdle0: PixelMap = {
	name: "shade_idle0",
	width: 18,
	height: 20,
	legend: LEGEND,
	rows: body(false, HEM0),
};

export const shadeIdle1: PixelMap = {
	name: "shade_idle1",
	width: 18,
	height: 20,
	legend: LEGEND,
	rows: body(true, HEM1),
};
