import { hashNoise } from "../noise.js";
import type { PixelMap } from "../pixelmap.js";
import { PORTAL_GRID, PORTAL_LEGEND, portalArch } from "./portal-arch.js";

/**
 * Portal-type arches (2026-09-28): one variant per document family, all the
 * base arch's exact silhouette and opening (PORTAL_INTERIOR is never drawn
 * into), tailored only in rune colour, a keystone plaque with an emblem, a
 * capstone finial, pillar capital/base trim bands with a gem, and moss
 * recolouring/flowers — plus one signature accent each for README (banner)
 * and sealed (chains). The engine composites these as a static overlay over
 * the shared animated base strip (see portal-variants script), so nothing
 * here may *remove* base pixels: every stamp only recolours or adds.
 *
 * Order is load-bearing: it is the frame order of the overlay sheet, mirrored
 * by the engine's systems/archVariant.ts ARCH_VARIANTS (a test there checks
 * it against the generated portal_arch_variants.json index).
 */
export const ARCH_VARIANT_IDS = [
	"readme",
	"markdown",
	"python",
	"javascript",
	"typescript",
	"csharp",
	"ruby",
	"rust",
	"go",
	"jvm",
	"cfamily",
	"shell",
	"config",
	"web",
	"image",
	"audio",
	"pdf",
	"table",
	"url",
	"sealed",
] as const;
export type ArchVariantId = (typeof ARCH_VARIANT_IDS)[number];

type FinialKind =
	| "orb"
	| "crystal"
	| "flame"
	| "gem"
	| "gear"
	| "star"
	| "note"
	| "sun"
	| "quill"
	| "leaf"
	| "crown";

interface VariantSpec {
	label: string;
	/** Rune inlay: glowing glyph colour, and the darker gap between glyphs. */
	rune: [number, number];
	/** Keystone plaque: backing, frame, and the emblem's two inks. */
	plaque: { bg: number; border: number; fg: number; detail: number };
	/** 8x5 emblem, '.' = plaque backing, 'F'/'D' = the two inks. */
	emblem: readonly string[];
	/** Capital and base bands on both pillars: lit, mid, shade. */
	trim: [number, number, number];
	gem: number;
	finial: FinialKind;
	/** Finial light, mid, dark. */
	finialInks: [number, number, number];
	/** Moss shadow/highlight (replaces the base greens), plus an optional flower colour dotted through it. */
	moss?: [number, number];
	flower?: number;
	banner?: [number, number];
	chains?: [number, number];
}

// Palette indices (assets/generated/palette.json) used below, by name, so the
// specs read as colours instead of magic numbers.
const C = {
	outline: 0,
	leather: 2,
	deadMossDark: 3,
	mossDark: 4,
	brownInk: 5,
	deadMoss: 7,
	moss: 9,
	brass: 10,
	amber: 12,
	orange: 13,
	gold: 21,
	brassLight: 24,
	goldWarm: 25,
	parchment: 26,
	cream: 27,
	bone: 29,
	ghostBlue: 30,
	slate: 31,
	plum: 32,
	amethyst: 33,
	ember: 34,
	wisp: 35,
	blossom: 36,
	cornflower: 37,
	butter: 38,
	berry: 39,
	meadow: 40,
	meadowBright: 41,
	meadowPale: 42,
	grove: 43,
	groveMid: 44,
	glade: 46,
	sandShadow: 49,
	sand: 50,
	sandLight: 51,
	pink: 52,
	sky: 53,
	sun: 54,
	scarlet: 55,
	autumn: 56,
	autumnDark: 57,
	stoneLight: 58,
	stoneMid: 59,
	stoneDark: 60,
	woodDark: 62,
	terracotta: 64,
	lantern: 65,
	sapphire: 66,
	navy: 67,
	cyan: 68,
} as const;

// 3x5 letters for the two-letter plaques; kept as a tiny local font because
// nothing else in the pipeline draws text.
const LETTER: Record<string, readonly string[]> = {
	J: ["DDD", "..D", "..D", "D.D", "DD."],
	S: ["DDD", "D..", "DDD", "..D", "DDD"],
	T: ["DDD", ".D.", ".D.", ".D.", ".D."],
	C: [".DD", "D..", "D..", "D..", ".DD"],
	G: [".DD", "D..", "D.D", "D.D", ".DD"],
	O: [".D.", "D.D", "D.D", "D.D", ".D."],
	"#": [".D.D", "DDDD", ".D.D", "DDDD", ".D.D"],
	"+": ["...", ".F.", "FFF", ".F.", "..."],
	"{": [".DD", ".D.", "D..", ".D.", ".DD"],
	"}": ["DD.", ".D.", "..D", ".D.", "DD."],
	">": ["D..", ".D.", "..D", ".D.", "D.."],
	_: ["...", "...", "...", "...", "DDD"],
};

/** Two letters with a one-cell gap, left-aligned in the 8-wide emblem (a 3-wide second letter leaves the last column as backing). */
function word(a: string, b: string, secondInk: "D" | "F" = "D"): string[] {
	const la = LETTER[a] ?? LETTER.O ?? [];
	const lb = LETTER[b] ?? LETTER.O ?? [];
	return Array.from({ length: 5 }, (_, y) => {
		const right = (lb[y] ?? "...").replace(/D/g, secondInk);
		return `${la[y] ?? "..."}.${right}`.padEnd(8, ".");
	});
}

const SPECS: Record<ArchVariantId, VariantSpec> = {
	readme: {
		label: "README / docs",
		rune: [C.goldWarm, C.amber],
		plaque: {
			bg: C.woodDark,
			border: C.gold,
			fg: C.cream,
			detail: C.brownInk,
		},
		emblem: [".FFFFFF.", ".FDDDDF.", ".FFFFFF.", ".FDDDFF.", ".FFFFFF."],
		trim: [C.sandLight, C.sand, C.sandShadow],
		gem: C.sun,
		finial: "quill",
		finialInks: [C.bone, C.cream, C.parchment],
		flower: C.bone,
		banner: [C.cream, C.parchment],
	},
	markdown: {
		label: "Markdown",
		rune: [C.bone, C.slate],
		plaque: { bg: C.slate, border: C.stoneDark, fg: C.bone, detail: C.bone },
		emblem: [".D....D.", ".DD..DD.", ".D.DD.D.", ".D....D.", ".D....D."],
		trim: [C.stoneLight, C.stoneMid, C.stoneDark],
		gem: C.ghostBlue,
		finial: "leaf",
		finialInks: [C.meadowPale, C.meadowBright, C.grove],
		flower: C.blossom,
	},
	python: {
		label: "Python",
		rune: [C.sun, C.sapphire],
		plaque: { bg: C.navy, border: C.sapphire, fg: C.sun, detail: C.sky },
		emblem: ["..DDD...", ".D.DD...", ".DDDDFF.", "...FFFF.", "...FF.F."],
		trim: [C.sky, C.sapphire, C.navy],
		gem: C.sun,
		finial: "orb",
		finialInks: [C.butter, C.sun, C.gold],
		flower: C.sun,
	},
	javascript: {
		label: "JavaScript",
		rune: [C.sun, C.gold],
		plaque: { bg: C.sun, border: C.gold, fg: C.outline, detail: C.outline },
		emblem: word("J", "S"),
		trim: [C.butter, C.gold, C.orange],
		gem: C.lantern,
		finial: "flame",
		finialInks: [C.lantern, C.sun, C.autumn],
		flower: C.butter,
	},
	typescript: {
		label: "TypeScript",
		rune: [C.cornflower, C.sapphire],
		plaque: { bg: C.sapphire, border: C.navy, fg: C.bone, detail: C.bone },
		emblem: word("T", "S"),
		trim: [C.cornflower, C.sapphire, C.navy],
		gem: C.ghostBlue,
		finial: "crystal",
		finialInks: [C.ghostBlue, C.sky, C.sapphire],
		flower: C.cornflower,
	},
	csharp: {
		label: "C#",
		rune: [C.amethyst, C.plum],
		plaque: { bg: C.plum, border: C.amethyst, fg: C.bone, detail: C.amethyst },
		emblem: word("C", "#", "F"),
		trim: [C.amethyst, C.plum, C.outline],
		gem: C.butter,
		finial: "crown",
		finialInks: [C.butter, C.gold, C.amber],
		flower: C.amethyst,
	},
	ruby: {
		label: "Ruby",
		rune: [C.scarlet, C.ember],
		plaque: { bg: C.outline, border: C.gold, fg: C.scarlet, detail: C.blossom },
		emblem: [".DDFFFF.", "DDFFFFFF", ".FFFFFF.", "..FFFF..", "...FF..."],
		trim: [C.berry, C.ember, C.leather],
		gem: C.scarlet,
		finial: "gem",
		finialInks: [C.blossom, C.scarlet, C.ember],
		flower: C.scarlet,
	},
	rust: {
		label: "Rust",
		rune: [C.autumn, C.autumnDark],
		plaque: {
			bg: C.woodDark,
			border: C.autumnDark,
			fg: C.terracotta,
			detail: C.outline,
		},
		emblem: [".F.FF.F.", "..FFFF..", "FFFDDFFF", "..FFFF..", ".F.FF.F."],
		trim: [C.terracotta, C.autumnDark, C.brownInk],
		gem: C.autumn,
		finial: "gear",
		finialInks: [C.autumn, C.terracotta, C.brownInk],
		// Rust patina in place of moss — the one variant whose "growth" is metal.
		moss: [C.brownInk, C.autumnDark],
	},
	go: {
		label: "Go",
		rune: [C.cyan, C.glade],
		plaque: { bg: C.cyan, border: C.glade, fg: C.bone, detail: C.bone },
		emblem: word("G", "O"),
		trim: [C.wisp, C.cyan, C.glade],
		gem: C.wisp,
		finial: "orb",
		finialInks: [C.wisp, C.cyan, C.glade],
		flower: C.wisp,
	},
	jvm: {
		label: "Java / Kotlin / Scala",
		rune: [C.autumn, C.brownInk],
		plaque: { bg: C.ember, border: C.outline, fg: C.bone, detail: C.ghostBlue },
		emblem: ["..D..D..", ".D..D...", ".FFFFF..", ".FFFFFFF", "..FFF..."],
		trim: [C.autumn, C.orange, C.brownInk],
		gem: C.goldWarm,
		finial: "flame",
		finialInks: [C.goldWarm, C.autumn, C.ember],
		flower: C.autumn,
	},
	cfamily: {
		label: "C / C++",
		rune: [C.cornflower, C.slate],
		plaque: {
			bg: C.slate,
			border: C.stoneDark,
			fg: C.sky,
			detail: C.ghostBlue,
		},
		emblem: word("C", "+", "F"),
		trim: [C.stoneLight, C.cornflower, C.stoneDark],
		gem: C.cornflower,
		finial: "crystal",
		finialInks: [C.ghostBlue, C.cornflower, C.slate],
	},
	shell: {
		label: "Shell / scripts",
		rune: [C.meadowBright, C.grove],
		plaque: {
			bg: C.outline,
			border: C.stoneDark,
			fg: C.meadowBright,
			detail: C.meadowBright,
		},
		emblem: word(">", "_"),
		trim: [C.stoneDark, C.slate, C.outline],
		gem: C.meadowBright,
		finial: "orb",
		finialInks: [C.meadowPale, C.meadowBright, C.grove],
	},
	config: {
		label: "Config / data",
		rune: [C.sand, C.sandShadow],
		plaque: {
			bg: C.woodDark,
			border: C.brass,
			fg: C.goldWarm,
			detail: C.goldWarm,
		},
		emblem: word("{", "}"),
		trim: [C.brassLight, C.sandShadow, C.brass],
		gem: C.goldWarm,
		finial: "gear",
		finialInks: [C.sand, C.brassLight, C.brass],
	},
	web: {
		label: "HTML / CSS",
		rune: [C.autumn, C.autumnDark],
		plaque: { bg: C.navy, border: C.sapphire, fg: C.sky, detail: C.autumn },
		emblem: ["....F...", ".D..F.D.", "D..FF..D", ".D.F..D.", "...F...."],
		trim: [C.autumn, C.autumnDark, C.brownInk],
		gem: C.sky,
		finial: "orb",
		finialInks: [C.ghostBlue, C.sky, C.sapphire],
		flower: C.sky,
	},
	image: {
		label: "Image",
		rune: [C.butter, C.gold],
		plaque: { bg: C.sky, border: C.gold, fg: C.sun, detail: C.meadow },
		emblem: [".....FF.", ".....FF.", "..D.....", ".DDD..D.", "DDDDDDDD"],
		trim: [C.sun, C.gold, C.amber],
		gem: C.sky,
		finial: "sun",
		finialInks: [C.lantern, C.sun, C.gold],
		flower: C.pink,
	},
	audio: {
		label: "Audio",
		rune: [C.blossom, C.plum],
		plaque: { bg: C.plum, border: C.blossom, fg: C.bone, detail: C.bone },
		emblem: ["....FF..", "....F.F.", "....F...", "..FFF...", "..FF...."],
		trim: [C.blossom, C.pink, C.plum],
		gem: C.bone,
		finial: "note",
		finialInks: [C.bone, C.blossom, C.plum],
		flower: C.pink,
	},
	pdf: {
		label: "PDF",
		rune: [C.goldWarm, C.brownInk],
		plaque: { bg: C.outline, border: C.gold, fg: C.berry, detail: C.gold },
		emblem: [".DFFFFF.", ".DFFDFF.", ".DFDDDF.", ".DFFDFF.", ".DFFFFF."],
		trim: [C.berry, C.leather, C.outline],
		gem: C.goldWarm,
		finial: "orb",
		finialInks: [C.goldWarm, C.gold, C.amber],
	},
	table: {
		label: "Spreadsheet / CSV",
		rune: [C.meadowBright, C.grove],
		plaque: { bg: C.cream, border: C.woodDark, fg: C.cream, detail: C.grove },
		emblem: ["DDDDDDDD", "DFFDFFFD", "DDDDDDDD", "DFFDFFFD", "DDDDDDDD"],
		trim: [C.groveMid, C.grove, C.outline],
		gem: C.meadowPale,
		finial: "gem",
		finialInks: [C.meadowPale, C.meadowBright, C.grove],
	},
	url: {
		label: "Website / url",
		rune: [C.sky, C.sapphire],
		plaque: { bg: C.navy, border: C.sky, fg: C.ghostBlue, detail: C.sun },
		emblem: ["...F....", "..FDF...", "FFDDDFF.", "..FDF...", "...F...."],
		trim: [C.ghostBlue, C.sky, C.sapphire],
		gem: C.ghostBlue,
		finial: "star",
		finialInks: [C.bone, C.ghostBlue, C.sky],
		flower: C.ghostBlue,
	},
	sealed: {
		label: "Sealed / binary",
		rune: [C.berry, C.leather],
		plaque: {
			bg: C.stoneDark,
			border: C.outline,
			fg: C.gold,
			detail: C.stoneLight,
		},
		emblem: ["..DDD...", ".D...D..", "FFFFFFF.", "FFF.FFF.", "FFFFFFF."],
		trim: [C.stoneDark, C.slate, C.outline],
		gem: C.berry,
		finial: "orb",
		finialInks: [C.stoneMid, C.stoneDark, C.slate],
		moss: [C.deadMossDark, C.deadMoss],
		chains: [C.stoneMid, C.slate],
	},
};

export function archVariantLabel(id: ArchVariantId): string {
	return SPECS[id].label;
}

/** A light colour per variant for glow/contact-sheet use — the rune's glowing ink. */
export function archVariantRune(id: ArchVariantId): number {
	return SPECS[id].rune[0];
}

// 6x4 finials sitting on the apex (grid x 21-26, rows 0-3; row 3 is the
// arch's own top outline). 'O' outline, 'N' light, 'n' mid, 'q' dark.
const FINIALS: Record<FinialKind, readonly string[]> = {
	orb: ["..OO..", ".ONnO.", ".OnqO.", "..OO.."],
	crystal: ["...O..", "..ONO.", ".ONnqO", ".OnqqO"],
	flame: ["..O...", ".ONO..", ".ONnO.", ".OnqO."],
	gem: [".OOOO.", "ONNnnO", ".OnqO.", "..OO.."],
	gear: [".qOOq.", "qNnnqq", "qnOOnq", ".qnnq."],
	star: ["..On..", "OnNNqO", "..nq..", "..Oq.."],
	note: ["...NO.", "...nNO", ".OOn..", ".OqO.."],
	sun: ["N.nn.N", ".nNNn.", "nNNNNn", ".nnnn."],
	quill: ["....ON", "...ONO", "..ONO.", ".Oq..."],
	leaf: ["..OO..", ".ONnO.", "..Oq..", "..Oq.."],
	crown: ["N.NN.N", "NnNNnN", "nnnnnn", "qqqqqq"],
};

const FINIAL_X0 = 21;
const PLAQUE = { x0: 19, y0: 5, w: 10, h: 7 };
const PILLAR_BANDS = [
	[7, 10],
	[37, 40],
] as const;
const CAPITAL_ROWS = [15, 16] as const;
const BASE_ROWS = [45, 46] as const;
const CHAIN_ROWS = [22, 23, 36, 37] as const;
/** Outline to outline on each pillar (the rune column stays lit). */
const CHAIN_SPANS = [
	[6, 10],
	[37, 41],
] as const;
const FLOWER_SEED = 20260929;

// New legend chars (never used by the base arch). Base chars keep their
// meaning; r/R/v/V are re-pointed per variant.
const LEGEND_EXTRA = {
	a: "trim light",
	b: "trim mid",
	c: "trim dark",
	g: "gem",
	P: "plaque backing",
	B: "plaque frame",
	F: "emblem ink",
	D: "emblem detail ink",
	N: "finial light",
	n: "finial mid",
	q: "finial dark",
	f: "flower",
	w: "banner light",
	W: "banner dark",
	x: "chain link",
	X: "chain shadow",
} as const;
export const VARIANT_LEGEND_CHARS = Object.keys(LEGEND_EXTRA);

function legendFor(spec: VariantSpec): Record<string, number> {
	const [mossDark, mossLight] = spec.moss ?? [
		PORTAL_LEGEND.v ?? C.mossDark,
		PORTAL_LEGEND.V ?? C.moss,
	];
	return {
		...PORTAL_LEGEND,
		r: spec.rune[0],
		R: spec.rune[1],
		v: mossDark,
		V: mossLight,
		a: spec.trim[0],
		b: spec.trim[1],
		c: spec.trim[2],
		g: spec.gem,
		P: spec.plaque.bg,
		B: spec.plaque.border,
		F: spec.plaque.fg,
		D: spec.plaque.detail,
		N: spec.finialInks[0],
		n: spec.finialInks[1],
		q: spec.finialInks[2],
		f: spec.flower ?? mossLight,
		w: spec.banner?.[0] ?? C.cream,
		W: spec.banner?.[1] ?? C.parchment,
		x: spec.chains?.[0] ?? C.stoneMid,
		X: spec.chains?.[1] ?? C.slate,
	};
}

/** The static (mote-free) arch for one variant, on the base arch's 48x48 grid. */
export function portalVariantMap(id: ArchVariantId): PixelMap {
	const spec = SPECS[id];
	const rows = portalArch.rows.map((row) => row.split(""));
	const set = (x: number, y: number, ch: string) => {
		const row = rows[y];
		if (row && x >= 0 && x < PORTAL_GRID) row[x] = ch;
	};
	const at = (x: number, y: number) => rows[y]?.[x] ?? ".";
	const isStone = (x: number, y: number) => "LSskvVf".includes(at(x, y));

	for (let y = 0; y < PORTAL_GRID; y++) {
		for (let x = 0; x < PORTAL_GRID; x++) {
			const ch = at(x, y);
			if (
				spec.flower !== undefined &&
				(ch === "v" || ch === "V") &&
				hashNoise(x, y, FLOWER_SEED) < 0.22
			)
				set(x, y, "f");
		}
	}

	if (spec.banner) {
		for (let x = 10; x <= 37; x++) set(x, 12, "w");
		for (let x = 9; x <= 38; x++) set(x, 13, x % 3 === 0 ? "w" : "W");
	}

	for (const [x0, x1] of PILLAR_BANDS) {
		for (let x = x0; x <= x1; x++) {
			if (isStone(x, CAPITAL_ROWS[0])) set(x, CAPITAL_ROWS[0], "a");
			if (isStone(x, CAPITAL_ROWS[1]))
				set(x, CAPITAL_ROWS[1], x === x0 + 1 || x === x0 + 2 ? "g" : "b");
			if (isStone(x, BASE_ROWS[0])) set(x, BASE_ROWS[0], "a");
			if (isStone(x, BASE_ROWS[1])) set(x, BASE_ROWS[1], "c");
		}
	}

	if (spec.chains) {
		for (const [x0, x1] of CHAIN_SPANS) {
			CHAIN_ROWS.forEach((y, i) => {
				for (let x = x0; x <= x1; x++) {
					set(x, y, (x + i) % 2 === 0 ? "x" : "X");
				}
			});
		}
	}

	const { x0, y0, w, h } = PLAQUE;
	for (let y = y0; y < y0 + h; y++) {
		for (let x = x0; x < x0 + w; x++) {
			const edge = y === y0 || y === y0 + h - 1 || x === x0 || x === x0 + w - 1;
			const emblem = spec.emblem[y - y0 - 1]?.[x - x0 - 1];
			set(x, y, edge ? "B" : emblem === "F" || emblem === "D" ? emblem : "P");
		}
	}

	FINIALS[spec.finial].forEach((line, dy) => {
		for (let dx = 0; dx < line.length; dx++) {
			const ch = line[dx];
			if (ch && ch !== ".") set(FINIAL_X0 + dx, dy, ch);
		}
	});

	return {
		name: `portal_arch_${id}`,
		width: PORTAL_GRID,
		height: PORTAL_GRID,
		legend: legendFor(spec),
		rows: rows.map((row) => row.join("")),
	};
}
