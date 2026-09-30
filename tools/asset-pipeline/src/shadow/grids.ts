import { hashNoise } from "../noise.js";
import {
	createGrid,
	fillEllipse,
	fillRect,
	type Grid,
	outlineGrid,
	setPixel,
} from "../pixel-shapes.js";
import type { PixelMap } from "../pixelmap.js";
import { PORTAL_GRID, portalArchFrame } from "../pixelmaps/portal-arch.js";
import { buildBiomeTileFrames } from "../world-art/biome-tiles.js";
import { pen } from "../world-art/pen.js";
import {
	WORLD_FOUNTAIN_FRAME_COUNT,
	WORLD_FOUNTAIN_HEIGHT,
	WORLD_FOUNTAIN_WIDTH,
} from "../world-art/world-fountain.js";
import type { NetherPalette } from "./palette.js";

type N = NetherPalette["n"];

// --- Ground tiles ------------------------------------------------------------

/** Fixed per-variant detail (never per-pixel noise: the "Minecraft dirt" speckle was rejected) — kept off the tile border so the base variants tile seamlessly. */
const NETHERRACK_DETAIL: readonly (readonly [
	number,
	number,
	"crack" | "ember",
])[][] = [
	[
		[5, 6, "crack"],
		[6, 7, "crack"],
		[7, 7, "crack"],
		[8, 8, "crack"],
		[12, 12, "ember"],
	],
	[
		[3, 10, "crack"],
		[4, 10, "crack"],
		[5, 11, "crack"],
		[11, 5, "ember"],
	],
	[
		[9, 11, "crack"],
		[10, 12, "crack"],
		[10, 13, "crack"],
		[11, 13, "crack"],
	],
	[
		[12, 3, "crack"],
		[12, 4, "crack"],
		[13, 5, "crack"],
		[4, 4, "ember"],
	],
];

export function netherrackTileFrames(n: N): Grid[] {
	const frames = buildBiomeTileFrames({
		shadow: n.netherDeep,
		base: n.netherBase,
		highlight: n.netherLight,
	});
	NETHERRACK_DETAIL.forEach((detail, v) => {
		const grid = frames[v];
		if (!grid) return;
		for (const [x, y, kind] of detail)
			setPixel(grid, x, y, kind === "crack" ? n.netherCrack : n.emberOrange);
	});
	return frames;
}

const OBSIDIAN_GLINTS: readonly (readonly [number, number])[][] = [
	[
		[4, 3],
		[11, 9],
	],
	[[7, 12]],
	[
		[2, 6],
		[13, 13],
	],
	[[9, 4]],
];

export function obsidianTileFrames(n: N): Grid[] {
	const frames = buildBiomeTileFrames({
		shadow: n.obsidianDeep,
		base: n.obsidianBase,
		highlight: n.obsidianLight,
	});
	OBSIDIAN_GLINTS.forEach((glints, v) => {
		const grid = frames[v];
		if (!grid) return;
		for (const [x, y] of glints) setPixel(grid, x, y, n.obsidianGlint);
	});
	return frames;
}

// --- Decals (12x12 native, soften cellSize 2 -> 24x24) -----------------------

const D = 12;

function emberBloom(n: N): Grid {
	const g = createGrid(D, D);
	for (const y of [8, 9, 10, 11]) setPixel(g, 5, y, n.charLight);
	fillEllipse(g, 5, 4.5, 2.4, 2.8, n.emberRed);
	fillEllipse(g, 5, 5, 1.6, 2, n.emberOrange);
	fillEllipse(g, 5, 5.6, 0.9, 1, n.emberYellow);
	setPixel(g, 5, 1, n.emberRed);
	setPixel(g, 3, 3, n.emberRed);
	setPixel(g, 7, 3, n.emberRed);
	return g;
}

function soulCrystal(n: N): Grid {
	const g = createGrid(D, D);
	for (let y = 3; y <= 10; y++) {
		const half = y < 6 ? (y - 3) * 0.5 : 1.5;
		for (let x = Math.round(5 - half); x <= Math.round(5 + half); x++)
			setPixel(g, x, y, x <= 5 ? n.soulCyan : n.soulDeep);
	}
	fillRect(g, 7, 7, 2, 4, n.soulDeep);
	setPixel(g, 7, 7, n.soulCyan);
	setPixel(g, 8, 6, n.soulCyan);
	setPixel(g, 4, 6, n.white);
	fillRect(g, 3, 11, 7, 1, n.blackstoneDark);
	return g;
}

function lavaCrack(n: N): Grid {
	const g = createGrid(D, D);
	const path: [number, number][] = [
		[1, 3],
		[2, 4],
		[3, 4],
		[4, 5],
		[5, 6],
		[6, 6],
		[7, 7],
		[8, 8],
		[9, 8],
		[10, 9],
		[6, 7],
		[5, 8],
		[5, 9],
	];
	for (const [x, y] of path) {
		setPixel(g, x, y + 1, n.netherCrack);
		setPixel(g, x, y, n.emberOrange);
	}
	setPixel(g, 5, 6, n.emberYellow);
	setPixel(g, 7, 7, n.emberYellow);
	return g;
}

function magmaPool(n: N): Grid {
	const g = createGrid(D, D);
	fillEllipse(g, 6, 7, 5, 3, n.blackstoneDark);
	fillEllipse(g, 6, 6.8, 4.2, 2.3, n.emberRed);
	fillEllipse(g, 6, 6.6, 3.2, 1.6, n.emberOrange);
	fillEllipse(g, 5.2, 6.3, 1.4, 0.7, n.emberYellow);
	setPixel(g, 8, 7, n.lavaHot);
	return g;
}

function bones(n: N, ink: number): Grid {
	const g = createGrid(D, D);
	fillEllipse(g, 4, 4.5, 2.4, 2.2, n.bone);
	fillRect(g, 3, 6, 3, 1, n.bone);
	setPixel(g, 3, 4, ink);
	setPixel(g, 5, 4, ink);
	setPixel(g, 4, 7, n.boneShadow);
	setPixel(g, 5, 6, n.boneShadow);
	for (let i = 0; i < 5; i++) {
		setPixel(g, 6 + i, 10 - i, i % 4 === 0 ? n.bone : n.boneShadow);
		setPixel(g, 6 + i, 9 - i, n.bone);
	}
	setPixel(g, 2, 10, n.bone);
	setPixel(g, 3, 10, n.boneShadow);
	setPixel(g, 4, 10, n.bone);
	return g;
}

function scorch(n: N): Grid {
	const g = createGrid(D, D);
	fillEllipse(g, 6, 6.5, 4.6, 3.2, n.netherDeep);
	fillEllipse(g, 6, 6.5, 3.2, 2, n.netherCrack);
	for (const [x, y] of [
		[3, 6],
		[4, 7],
		[8, 5],
		[9, 6],
		[6, 8],
	] as const)
		setPixel(g, x, y, n.ashMid);
	setPixel(g, 6, 6, n.emberRed);
	return g;
}

/** Order is load-bearing: the engine rings each clearing with frames 0 and 1. */
export function netherDecals(p: NetherPalette): { name: string; grid: Grid }[] {
	const n = p.n;
	return [
		{ name: "ember-bloom", grid: emberBloom(n) },
		{ name: "soul-crystal", grid: soulCrystal(n) },
		{ name: "lava-crack", grid: lavaCrack(n) },
		{ name: "magma-pool", grid: magmaPool(n) },
		{ name: "bones", grid: bones(n, p.ink) },
		{ name: "scorch", grid: scorch(n) },
	];
}

// --- Path ribbon -------------------------------------------------------------

/** Same grid sizes as scenery.ts's buildPathRibbon, so the ribbon planner's disc radii and cobble pitch fit the new stamps unchanged. */
export function lavaPathPieces(n: N): { name: string; grid: Grid }[] {
	const edge = createGrid(17, 17);
	fillEllipse(edge, 8.5, 8.5, 8.5, 8.5, n.blackstoneDark);
	fillEllipse(edge, 8.5, 8.5, 7.4, 7.4, n.blackstone);
	fillEllipse(edge, 8.5, 8.5, 6.4, 6.4, n.emberRed);
	const bed = createGrid(12, 12);
	fillEllipse(bed, 6, 6, 6, 6, n.emberOrange);
	fillEllipse(bed, 6, 6, 3.2, 3.2, n.emberYellow);
	const plates: Grid[] = [
		[4, 3],
		[3, 3],
		[4, 4],
		[3, 4],
	].map(([w = 3, h = 3]) => {
		const g = createGrid(w, h + 1);
		fillRect(g, 0, 1, w, h, n.blackstoneDark);
		fillRect(g, 0, 0, w, h, n.blackstone);
		setPixel(g, 0, 0, n.blackstoneLight);
		setPixel(g, 1, 0, n.blackstoneLight);
		setPixel(g, w - 1, h - 1, n.blackstoneDark);
		return g;
	});
	return [
		{ name: "lava-edge-disc", grid: edge },
		{ name: "lava-bed-disc", grid: bed },
		...plates.map((grid, i) => ({ name: `basalt-${i}`, grid })),
	];
}

// --- Portal arch -------------------------------------------------------------

export const PORTAL_FRAME_COUNT = 6;

/** The arch's own pixel map with its legend remapped: the silhouette and the transparent opening are the portal arch's cell for cell, so in-arch previews clip exactly as before. */
export function netherArchFrame(p: NetherPalette, frame: number): PixelMap {
	const map = portalArchFrame(frame, PORTAL_FRAME_COUNT);
	const n = p.n;
	return {
		...map,
		name: `portal_arch_nether_f${frame}`,
		legend: {
			O: p.ink,
			L: n.blackstoneLight,
			S: n.blackstone,
			s: n.blackstoneDark,
			k: n.obsidianDeep,
			v: n.netherBase,
			V: n.emberRed,
			r: n.emberOrange,
			R: n.netherDeep,
			m: n.emberOrange,
			M: n.emberYellow,
		},
	};
}

// 3x5 carved glyphs; '#' is a rune stroke.
const GLYPHS: readonly string[][] = [
	["#.#", ".#.", "###", ".#.", "#.#"],
	["##.", "#.#", "##.", "#..", "###"],
	[".#.", "###", "#.#", ".#.", ".#."],
	["#..", "##.", "#.#", ".##", "..#"],
	["###", "#..", ".#.", "..#", "###"],
];

/** Runes on the pillars and keystone, at stone cells of the base arch only (never the outline or the opening). */
const RUNE_SPOTS: readonly [number, number, number][] = [
	[7, 17, 0],
	[7, 25, 1],
	[7, 33, 2],
	[7, 41, 3],
	[38, 17, 4],
	[38, 25, 2],
	[38, 33, 0],
	[38, 41, 1],
	[22, 4, 3],
	[22, 10, 4],
];

export function runeOverlayFrame(p: NetherPalette, pulse: 0 | 1): PixelMap {
	const arch = portalArchFrame(0, PORTAL_FRAME_COUNT);
	const stone = (x: number, y: number) => {
		const c = arch.rows[y]?.[x];
		return c !== undefined && c !== "." && c !== "O";
	};
	const rows = Array.from({ length: PORTAL_GRID }, () =>
		Array.from({ length: PORTAL_GRID }, () => "."),
	);
	for (const [x0, y0, glyph] of RUNE_SPOTS) {
		const shape = GLYPHS[glyph] ?? [];
		shape.forEach((line, dy) => {
			for (let dx = 0; dx < line.length; dx++) {
				if (line[dx] !== "#") continue;
				const x = x0 + dx;
				const y = y0 + dy;
				const row = rows[y];
				if (!row || !stone(x, y)) continue;
				row[x] = dx === 1 || dy === 2 ? "c" : "e";
			}
		});
	}
	const n = p.n;
	return {
		name: `portal_arch_rune_overlay_f${pulse}`,
		width: PORTAL_GRID,
		height: PORTAL_GRID,
		legend:
			pulse === 0
				? { e: n.emberRed, c: n.emberOrange }
				: { e: n.emberOrange, c: n.emberYellow },
		rows: rows.map((r) => r.join("")),
	};
}

// --- Brazier (the world fountain's exact frame, 56x58 cells) -----------------

const BW = WORLD_FOUNTAIN_WIDTH;
const BH = WORLD_FOUNTAIN_HEIGHT;
const BCX = 28;
/** Bowl mouth row: the flames stand on it. */
export const BRAZIER_MOUTH_Y = 22;

function brazierStone(n: N, ink: number): Grid {
	const g = createGrid(BW, BH);
	const band = (y0: number, y1: number, half: number) => {
		for (let y = y0; y < y1; y++)
			for (let x = BCX - half; x < BCX + half; x++) {
				const edgeL = x < BCX - half + 2;
				const edgeR = x >= BCX + half - 2;
				setPixel(
					g,
					x,
					y,
					y === y0
						? n.blackstoneLight
						: edgeL
							? n.blackstoneLight
							: edgeR
								? n.blackstoneDark
								: n.blackstone,
				);
			}
	};
	band(50, 56, 22);
	band(44, 50, 17);
	band(31, 44, 6);
	for (let y = 33; y < 43; y += 3) setPixel(g, BCX - 1, y, n.emberRed);
	for (let y = 36; y < 43; y += 3) setPixel(g, BCX + 1, y, n.emberRed);
	// Bowl: a flared basin tapering into the column.
	for (let y = BRAZIER_MOUTH_Y; y < 32; y++) {
		const t = (y - BRAZIER_MOUTH_Y) / 9;
		const half = Math.round(17 - t * t * 10);
		for (let x = BCX - half; x < BCX + half; x++) {
			const shade =
				x < BCX - half + 3
					? n.blackstoneLight
					: x >= BCX + half - 3
						? n.blackstoneDark
						: n.blackstone;
			setPixel(g, x, y, y <= BRAZIER_MOUTH_Y + 1 ? n.blackstoneLight : shade);
		}
	}
	for (let x = BCX - 13; x < BCX + 13; x += 5) setPixel(g, x, 26, n.emberRed);
	// Glowing coals in the mouth.
	for (let x = BCX - 14; x < BCX + 14; x++) {
		const h = hashNoise(x, 0, 20261929);
		setPixel(
			g,
			x,
			BRAZIER_MOUTH_Y,
			h < 0.3 ? n.emberYellow : h < 0.7 ? n.emberOrange : n.emberRed,
		);
	}
	outlineGrid(g, ink);
	return g;
}

function paintFlames(g: Grid, n: N, frame: number): void {
	const phase = (frame / WORLD_FOUNTAIN_FRAME_COUNT) * Math.PI * 2;
	const tongues: [number, number, number, number][] = [
		[BCX, 18, 7, 0],
		[BCX - 8, 12, 5, 1.7],
		[BCX + 8, 13, 5, 3.4],
		[BCX - 3, 9, 3, 4.6],
		[BCX + 4, 10, 3, 2.3],
	];
	for (const [cx, height, halfW, off] of tongues) {
		const h = height + Math.round(Math.sin(phase + off) * 2.5);
		const sway = Math.sin(phase * 1 + off * 1.3) * 1.6;
		for (let dy = 0; dy < h; dy++) {
			const y = BRAZIER_MOUTH_Y - dy;
			const t = dy / h;
			const half = halfW * (1 - t) ** 0.8;
			const x0 = cx + sway * t;
			for (let x = Math.floor(x0 - half); x <= Math.ceil(x0 + half); x++) {
				const d = Math.abs(x + 0.5 - x0) / Math.max(0.6, half);
				if (d > 1) continue;
				const idx =
					d < 0.35 && t < 0.55
						? t < 0.3
							? n.lavaHot
							: n.emberYellow
						: d < 0.7
							? n.emberOrange
							: n.emberRed;
				const row = g[y];
				const cur = row?.[x];
				// Hotter cores win where tongues overlap.
				const rank = (v: number | null | undefined) =>
					v === n.lavaHot
						? 4
						: v === n.emberYellow
							? 3
							: v === n.emberOrange
								? 2
								: v === n.emberRed
									? 1
									: 0;
				if (rank(idx) > rank(cur)) setPixel(g, x, y, idx);
			}
		}
	}
	for (let i = 0; i < 3; i++) {
		const sx = BCX - 10 + ((i * 9 + frame * 3) % 21);
		const sy = 6 - ((frame * 2 + i * 3) % 6);
		setPixel(g, sx, sy, n.emberYellow);
	}
}

export function brazierFrame(p: NetherPalette, frame: number): Grid {
	const g = brazierStone(p.n, p.ink);
	paintFlames(g, p.n, frame);
	return g;
}

// --- Ash flakes (4x4 native -> 8x8) ------------------------------------------

export function ashFlakes(n: N): Grid[] {
	const shapes: [number, number, boolean][][] = [
		[
			[1, 1, true],
			[2, 1, false],
			[1, 2, false],
			[2, 2, false],
		],
		[
			[0, 1, false],
			[1, 1, true],
			[2, 2, false],
			[3, 2, false],
		],
		[
			[2, 0, false],
			[1, 1, true],
			[2, 1, false],
			[1, 2, false],
			[1, 3, false],
		],
	];
	return shapes.map((cells) => {
		const g = createGrid(4, 4);
		for (const [x, y, bright] of cells)
			setPixel(g, x, y, bright ? n.white : n.ashLight);
		return g;
	});
}

// --- Sudo icon (the item icons' 24x32 grid) ----------------------------------

export const ICON_W = 24;
export const ICON_H = 32;

export function sudoIconGrid(p: NetherPalette): Grid {
	const n = p.n;
	const g = createGrid(ICON_W, ICON_H);
	// Bow: an iron ring around a glowing sigil.
	fillEllipse(g, 12, 8.5, 7.5, 7.5, n.iron);
	for (let y = 1; y < 17; y++)
		for (let x = 4; x < 20; x++) {
			const dx = x + 0.5 - 12;
			const dy = y + 0.5 - 8.5;
			const r = Math.hypot(dx, dy);
			if (r > 7.5) continue;
			if (r > 6.2) {
				setPixel(
					g,
					x,
					y,
					dx + dy < -2 ? n.ironLight : dx + dy > 3 ? n.blackstoneDark : n.iron,
				);
			} else if (r > 4.8) {
				setPixel(g, x, y, n.netherDeep);
			} else {
				setPixel(g, x, y, r < 2 ? n.emberOrange : n.netherBase);
			}
		}
	// Sigil: a rune-cross with a hot core.
	for (let d = -3; d <= 3; d++) {
		setPixel(g, 12 + d, 8, n.emberOrange);
		setPixel(g, 12, 8 + d, n.emberOrange);
	}
	for (const [x, y] of [
		[9, 5],
		[15, 5],
		[9, 11],
		[15, 11],
	] as const)
		setPixel(g, x, y, n.emberRed);
	setPixel(g, 12, 8, n.lavaHot);
	setPixel(g, 11, 8, n.emberYellow);
	setPixel(g, 13, 8, n.emberYellow);
	setPixel(g, 12, 7, n.emberYellow);
	setPixel(g, 12, 9, n.emberYellow);
	// Shaft and bit.
	for (let y = 16; y <= 28; y++) {
		setPixel(g, 11, y, n.ironLight);
		setPixel(g, 12, y, n.iron);
		setPixel(g, 13, y, n.blackstoneDark);
	}
	for (const [y, w] of [
		[22, 4],
		[23, 4],
		[25, 3],
		[27, 4],
		[28, 4],
	] as const) {
		for (let x = 14; x < 14 + w; x++)
			setPixel(g, x, y, x === 14 + w - 1 ? n.blackstoneDark : n.iron);
	}
	setPixel(g, 12, 20, n.emberRed);
	setPixel(g, 12, 24, n.emberRed);
	outlineGrid(g, p.ink);
	// Ember flecks at the base: the owner items' counterpart to the leaf sprig
	// every other item icon carries.
	for (const [x, y, c] of [
		[4, 30, n.emberRed],
		[5, 29, n.emberOrange],
		[5, 30, n.emberYellow],
		[6, 30, n.emberRed],
		[18, 30, n.emberRed],
		[19, 29, n.emberOrange],
		[19, 30, n.emberOrange],
		[20, 30, n.emberRed],
		[19, 28, n.emberYellow],
	] as const)
		setPixel(g, x, y, c);
	return g;
}

// --- Scenery swaps (pen sizes match scenery.ts's pine/boulder/pond) ----------

const K = 3;

export function basaltPillar(n: N): Grid {
	const p = pen(14, 24, K);
	const column = (x: number, top: number, w: number) => {
		p.rect(x, top, w, 24 - top, n.blackstone);
		p.rect(x, top, w * 0.3, 24 - top, n.blackstoneLight);
		p.rect(x + w * 0.72, top, w * 0.28, 24 - top, n.blackstoneDark);
		p.rect(x, top, w, 0.67, n.blackstoneLight);
		p.tri(x, top, x + w, top, x + w / 2, top - 1.2, n.blackstoneLight);
		for (let y = top + 3; y < 23; y += 4)
			p.rect(x, y, w, 0.34, n.blackstoneDark);
	};
	column(1, 7, 4.2);
	column(8.6, 5, 4.4);
	column(4.6, 1.5, 4.4);
	p.rect(6.6, 9, 0.5, 5, n.emberOrange);
	p.rect(6.8, 14, 0.4, 3, n.emberRed);
	p.rect(10.2, 16, 0.4, 3, n.emberRed);
	return p.g;
}

export function magmaRock(n: N): Grid {
	const p = pen(15, 11, K);
	p.ellipse(7.5, 6.5, 7, 4.3, n.blackstoneDark);
	p.ellipse(7, 5.8, 6.3, 4, n.blackstone);
	p.ellipse(5, 4, 2.4, 1.4, n.blackstoneLight);
	const crack: [number, number][] = [
		[3, 6],
		[4.3, 6.6],
		[5.6, 6.2],
		[7, 7],
		[8.4, 6.4],
		[9.6, 5.2],
		[11, 5.6],
		[7, 7.8],
		[6.6, 8.6],
	];
	for (const [x, y] of crack) p.rect(x, y, 1, 0.67, n.emberOrange);
	p.rect(7, 7, 0.67, 0.67, n.emberYellow);
	p.rect(9.6, 5.2, 0.67, 0.67, n.emberYellow);
	return p.g;
}

export function lavaPond(n: N): Grid {
	const p = pen(40, 24, K);
	p.ellipse(20, 12, 19.5, 11.5, n.blackstoneDark);
	p.ellipse(20, 11.6, 18.8, 10.8, n.blackstone);
	p.speckle(0, 0, 40, 24, n.blackstone, n.blackstoneLight, 0.06, 81);
	p.ellipse(20, 12.4, 17.6, 9.8, n.emberRed);
	p.ellipse(20, 12.4, 15.4, 8, n.emberOrange);
	p.ellipse(19, 12, 10, 4.6, n.emberYellow);
	p.ellipse(18, 11.4, 4.2, 1.6, n.lavaHot);
	for (const [x, y, r] of [
		[10, 14.5, 1.8],
		[29, 9, 1.6],
		[27, 15, 1.2],
	] as const) {
		p.ellipse(x, y, r, r * 0.66, n.blackstoneDark);
		p.ellipse(x - 0.3, y - 0.3, r * 0.6, r * 0.4, n.blackstone);
	}
	return p.g;
}
