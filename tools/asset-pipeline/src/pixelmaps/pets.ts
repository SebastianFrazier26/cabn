import type { PixelMap } from "../pixelmap.js";

// The AI pets that follow the player once they bring their own provider key
// (engine src/pets/): one small animal per provider, each loosely in its
// provider's colours, on a 16x16 grid at the player's 2 screen px per cell
// (so a pet stands about half the player's height).
//
// Four frames each: 0 idle, 1 idle with a blink (or the whale's spout), 2
// and 3 the walk/follow cycle. Frames are one template with numbered
// placeholder cells resolved per frame (same idea as guide-npc.ts), so the
// frames can only differ in the cells a placeholder names. The ink outline
// is derived from the silhouette afterwards, which is why column/row 0 and
// 15 stay empty in every template.

export const PET_GRID = 16;
export const PET_FRAME_COUNT = 4;

export const PET_SPECIES = [
	"cat",
	"ferret",
	"bird",
	"llama",
	"owl",
	"whale",
] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

interface PetTemplate {
	/** Palette indices; "O" (outline) is always 0 and added automatically. */
	legend: Record<string, number>;
	rows: readonly string[];
	/** Per frame, what each placeholder digit becomes ("." = transparent). */
	frames: readonly Readonly<Record<string, string>>[];
}

// Placeholders shared by the legged pets: "E" eyes (blink on frame 1),
// "1"/"2" the two leg pairs (each lifted on one walk frame), "3" the paw
// cells a lifted leg vacates.
const LEGGED_FRAMES = (
	eye: string,
	lid: string,
	leg: string,
	paw: string,
): Record<string, string>[] => [
	{ E: eye, "1": leg, "2": leg, "3": paw, "4": paw },
	{ E: lid, "1": leg, "2": leg, "3": paw, "4": paw },
	{ E: eye, "1": paw, "2": leg, "3": ".", "4": paw },
	{ E: eye, "1": leg, "2": paw, "3": paw, "4": "." },
];

// Claude: a little orange cat — terracotta coat, tabby stripes, cream muzzle.
const CAT: PetTemplate = {
	legend: { b: 64, s: 57, l: 25, n: 52, E: 0, t: 13 },
	rows: [
		"................",
		".........b...b..",
		".........bb.bb..",
		"..t......bbbbb..",
		".tt.....bbbbbbb.",
		".t......bEbbbEb.",
		".t......bbbnbbb.",
		".tt.....lbbbbbl.",
		"..tbbbbbbllllb..",
		"..bbsbbsbbllbb..",
		"..bsbbsbbbbbbb..",
		"..bbbbbbbbbbbb..",
		"..bb.bb...bb.bb.",
		"..11.22...11.22.",
		"..33.44...33.44.",
		"................",
	],
	frames: LEGGED_FRAMES("E", "b", "b", "l"),
};

// OpenAI: a black ferret — charcoal coat, pale forehead, nose bridge and
// muzzle, a dark mask patch round each eye, black legs and tail, pink nose. Art
// polish 2 (2026-09-28): the first draft stood tall on long legs with a
// short body and pricked ears and read as a dog, so it is now what makes a
// ferret a ferret — a long, low, tubular body (3 cells tall, 8 long) on
// one-cell legs, small rounded ears, a wedge head and a long sagging tail.
const FERRET: PetTemplate = {
	legend: { b: 60, s: 31, m: 29, d: 67, n: 36, E: 0, t: 0, k: 0 },
	rows: [
		"................",
		"................",
		"................",
		"................",
		"................",
		"..........b..b..",
		"..........bmmmb.",
		"..........dEmEd.",
		".....bbbbbbmmmn.",
		".tttbbbbbbbbmm..",
		".t..sbbbbbbbs...",
		"....11.....22...",
		"....33.....44...",
		"................",
		"................",
		"................",
	],
	frames: LEGGED_FRAMES("E", "d", "k", "k"),
};

// Gemini: a blue bird — sky-blue body, deep blue wing, a violet crest for
// the gradient, yellow beak. Walking flaps the wing ("W" up, "w" down).
const BIRD: PetTemplate = {
	legend: {
		b: 53,
		w: 66,
		l: 30,
		c: 33,
		k: 54,
		f: 56,
		E: 0,
		t: 37,
	},
	rows: [
		"................",
		"................",
		".........cc.....",
		"........cbbb....",
		".......bbbbbb...",
		".....5.bbbbEbk..",
		"....55.bbbbbbkk.",
		".tt.55bbbbbbll..",
		"..ttbb666bblll..",
		"...tb6666bblll..",
		"....bb66bbbll...",
		".....bbbbbbb....",
		".......1..2.....",
		".......1..2.....",
		"......33.44.....",
		"................",
	],
	frames: [
		{ E: "E", "5": ".", "6": "w", "1": "f", "2": "f", "3": "f", "4": "f" },
		{ E: "b", "5": ".", "6": "w", "1": "f", "2": "f", "3": "f", "4": "f" },
		{ E: "E", "5": "w", "6": "b", "1": "f", "2": "f", "3": "f", "4": "f" },
		{ E: "E", "5": ".", "6": "w", "1": "f", "2": "f", "3": "f", "4": "f" },
	],
};

// Ollama: a llama — cream wool, fawn ears and muzzle, brown hooves.
const LLAMA: PetTemplate = {
	legend: { w: 27, s: 23, e: 22, m: 26, n: 0, E: 0, h: 62 },
	rows: [
		"................",
		"..........e..e..",
		"..........wwww..",
		".........wwwwww.",
		".........wwEwwm.",
		"..........wwwmn.",
		"..........www...",
		"..........www...",
		".ww.......www...",
		".wwwwwwwwwwww...",
		"..wwwwwwwwwww...",
		"..wsswwwwsswws..",
		"..ww.ww...ww.ww.",
		"..11.22...11.22.",
		"..33.44...33.44.",
		"................",
	],
	frames: LEGGED_FRAMES("E", "w", "w", "h"),
};

// Qwen: an owl — deep purple feathers, lavender breast, gold eyes. Walking
// is a waddle: the feet alternate and the wing tips lift.
const OWL: PetTemplate = {
	legend: {
		p: 32,
		l: 33,
		v: 36,
		y: 54,
		k: 24,
		f: 56,
		E: 0,
		W: 32,
	},
	rows: [
		"................",
		"...p........p...",
		"...pp......pp...",
		"...pppppppppp...",
		"..ppyyyppyyypp..",
		"..ppyEyppyEypp..",
		"..ppyyykkyyypp..",
		"..pppppkkppppp..",
		".5pllllllllllp5.",
		".5plvllvllvllp5.",
		"..pllllllllllp..",
		"..ppllvllvllpp..",
		"...pppppppppp...",
		".....11..22.....",
		".....33..44.....",
		"................",
	],
	frames: [
		{ E: "E", "5": ".", "1": "f", "2": "f", "3": "f", "4": "f" },
		{ E: "y", "5": ".", "1": "f", "2": "f", "3": "f", "4": "f" },
		{ E: "E", "5": "W", "1": "f", "2": "f", "3": ".", "4": "f" },
		{ E: "E", "5": "W", "1": "f", "2": "f", "3": "f", "4": "." },
	],
};

// DeepSeek: a whale — deep blue back, pale belly, a little spout. It floats
// (the engine bobs it), so its "walk" is the tail beating up and down.
const WHALE: PetTemplate = {
	legend: { b: 66, h: 53, l: 30, s: 29, E: 0, t: 66 },
	rows: [
		"................",
		"................",
		"................",
		"..........7.7...",
		"...........7....",
		"...........7....",
		".55....bbbbbb...",
		".555..bbbbbbbb..",
		"...5ttbbhhbbbbb.",
		"....tbbbbbbbbEb.",
		".666bbbbbbbbbbb.",
		".66..bllllllllb.",
		"......lllllllll.",
		"........llll....",
		"................",
		"................",
	],
	frames: [
		{ E: "E", "7": ".", "5": "t", "6": "." },
		{ E: "E", "7": "s", "5": "t", "6": "." },
		{ E: "E", "7": ".", "5": ".", "6": "." },
		{ E: "E", "7": ".", "5": ".", "6": "t" },
	],
};

const TEMPLATES: Record<PetSpecies, PetTemplate> = {
	cat: CAT,
	ferret: FERRET,
	bird: BIRD,
	llama: LLAMA,
	owl: OWL,
	whale: WHALE,
};

function withOutline(rows: string[][]): void {
	const filled = (x: number, y: number) => (rows[y]?.[x] ?? ".") !== ".";
	const edge: [number, number][] = [];
	for (let y = 0; y < rows.length; y++) {
		const row = rows[y] ?? [];
		for (let x = 0; x < row.length; x++) {
			if (row[x] !== ".") continue;
			if (
				filled(x - 1, y) ||
				filled(x + 1, y) ||
				filled(x, y - 1) ||
				filled(x, y + 1)
			) {
				edge.push([x, y]);
			}
		}
	}
	for (const [x, y] of edge) {
		const row = rows[y];
		if (row) row[x] = "O";
	}
}

/** The template before placeholders resolve — exported for the test's margin check. */
export function petTemplateRows(species: PetSpecies): readonly string[] {
	return TEMPLATES[species].rows;
}

export function petFrame(species: PetSpecies, frame: number): PixelMap {
	const template = TEMPLATES[species];
	const resolve = template.frames[frame];
	if (!resolve) throw new Error(`pet ${species}: no frame ${frame}`);
	const rows = template.rows.map((row) =>
		[...row].map((char) => resolve[char] ?? char),
	);
	withOutline(rows);
	return {
		name: `pet_${species}_f${frame}`,
		width: PET_GRID,
		height: PET_GRID,
		legend: { ...template.legend, O: 0 },
		rows: rows.map((r) => r.join("")),
	};
}
