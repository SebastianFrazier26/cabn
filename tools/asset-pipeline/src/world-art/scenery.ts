import {
	createGrid,
	fillEllipse,
	fillRect,
	fillTriangle,
	type Grid,
	type GroundTonesLike,
	setPixel,
	shadeEllipseVolume,
} from "../pixel-shapes.js";

/**
 * M10 atmosphere pass (2026-09-28): edge scenery and points of interest for
 * the empty margins around a world's clearings, the horizon skyline, the
 * night-sky ornaments and the path-ribbon pieces. Kept out of props.ts
 * because none of it joins the per-clearing random prop pool — the engine
 * bakes it (render/sceneryBaker.ts, render/pathBaker.ts) or layers it
 * (render/skyline.ts).
 *
 * Density: everything here renders at 2 screen px per grid cell (soften
 * cellSize 2, drawn unscaled), matching the tower, cabins, world cabinet
 * and player — NOT the 6px-per-cell scatter props, which read as a second,
 * chunkier art style next to them (art-consistency review, 2026-09-28).
 * Shapes are designed in coarse "base units" for readability and drawn
 * through a Pen that scales every coordinate by `k`, so silhouettes and
 * shading bands resolve at the fine cell size; per-cell speckle adds the
 * fine texture a coarse design alone wouldn't have.
 */
export const FINE_CELL_SIZE = 2;
const SCENERY_K = 3;
const SKYLINE_K = 2;

export interface SceneryPiece {
	name: string;
	grid: Grid;
	cellSize: number;
}

interface Pen {
	g: Grid;
	rect(x: number, y: number, w: number, h: number, idx: number): void;
	ellipse(cx: number, cy: number, rx: number, ry: number, idx: number): void;
	tri(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		idx: number,
	): void;
	/** One base-unit block. */
	px(x: number, y: number, idx: number): void;
	/** One fine cell, in fine coordinates. */
	fine(x: number, y: number, idx: number): void;
	shade(
		cx: number,
		cy: number,
		rx: number,
		ry: number,
		tones: GroundTonesLike,
	): void;
	/** Deterministically flips a fraction of `from`-colored fine cells in a base-unit box to `to` — leaf/stone texture at the fine cell size. */
	speckle(
		x: number,
		y: number,
		w: number,
		h: number,
		from: number,
		to: number,
		density: number,
		seed: number,
	): void;
}

function cellHash(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function pen(width: number, height: number, k: number): Pen {
	const g = createGrid(Math.round(width * k), Math.round(height * k));
	const r = Math.round;
	return {
		g,
		rect: (x, y, w, h, idx) =>
			fillRect(g, r(x * k), r(y * k), r(w * k), r(h * k), idx),
		ellipse: (cx, cy, rx, ry, idx) =>
			fillEllipse(g, cx * k, cy * k, rx * k, ry * k, idx),
		tri: (x0, y0, x1, y1, x2, y2, idx) =>
			fillTriangle(g, x0 * k, y0 * k, x1 * k, y1 * k, x2 * k, y2 * k, idx),
		px: (x, y, idx) => fillRect(g, r(x * k), r(y * k), k, k, idx),
		fine: (x, y, idx) => setPixel(g, x, y, idx),
		shade: (cx, cy, rx, ry, tones) =>
			shadeEllipseVolume(g, cx * k, cy * k, rx * k, ry * k, tones),
		speckle: (x, y, w, h, from, to, density, seed) => {
			for (let fy = r(y * k); fy < r((y + h) * k); fy++) {
				const row = g[fy];
				if (!row) continue;
				for (let fx = r(x * k); fx < r((x + w) * k); fx++) {
					if (row[fx] === from && cellHash(fx, fy, seed) < density)
						row[fx] = to;
				}
			}
		},
	};
}

export interface SceneryPalette {
	pineTones: GroundTonesLike;
	oakTones: GroundTonesLike;
	shrubTones: GroundTonesLike;
	trunk: number;
	trunkDark: number;
	stone: number;
	stoneShadow: number;
	stoneHighlight: number;
	moss: number;
	berry: number;
	blossom: number;
	petalA: number;
	petalB: number;
	petalC: number;
	petalCenter: number;
	stem: number;
	reed: number;
	reedTip: number;
	capRed: number;
	capShadow: number;
	capSpot: number;
	stalk: number;
	water: number;
	waterDeep: number;
	waterShine: number;
	shore: number;
	lily: number;
	wood: number;
	woodDark: number;
	woodLight: number;
	plaster: number;
	plasterShadow: number;
	roof: number;
	roofShadow: number;
	sailCloth: number;
	windowGlow: number;
	plank: number;
	ink: number;
}

/** Three stacked triangle tiers — a conifer silhouette, which reads as "forest" at a glance when packed shoulder to shoulder. */
function pine(tones: GroundTonesLike, trunk: number, trunkDark: number): Grid {
	const p = pen(14, 24, SCENERY_K);
	p.rect(6, 19, 2, 5, trunk);
	p.rect(7.33, 19, 0.67, 5, trunkDark);
	const tiers: [number, number, number][] = [
		[20, 7, 11],
		[14, 5.8, 8],
		[8.5, 4.4, 6],
	];
	for (const [base, halfW, tierH] of tiers) {
		p.tri(
			7 - halfW - 0.6,
			base,
			7 + halfW + 0.6,
			base,
			7,
			base - tierH,
			tones.shadow,
		);
		p.tri(
			7 - halfW,
			base - 0.7,
			7 + halfW * 0.7,
			base - 0.7,
			7,
			base - tierH,
			tones.base,
		);
		p.tri(
			7 - halfW * 0.8,
			base - 1.6,
			6.6,
			base - 1.6,
			7,
			base - tierH + 0.8,
			tones.highlight,
		);
	}
	p.speckle(0, 0, 14, 20, tones.base, tones.highlight, 0.1, 11);
	p.speckle(0, 0, 14, 20, tones.base, tones.shadow, 0.1, 12);
	return p.g;
}

/** Broad round-canopy tree, the forest's second silhouette next to pine — fine-density replacement for reusing the coarse tree-large prop at the edges. */
function oak(
	tones: GroundTonesLike,
	trunk: number,
	trunkDark: number,
	blossom?: number,
): Grid {
	const p = pen(20, 26, SCENERY_K);
	p.rect(8.7, 17, 2.6, 9, trunk);
	p.rect(10.4, 17, 0.9, 9, trunkDark);
	p.tri(7.5, 26, 12.5, 26, 10, 23, trunk);
	const blobs: [number, number, number, number][] = [
		[10, 11, 8.6, 6.4],
		[5.2, 13.4, 4.4, 3.6],
		[14.8, 13.4, 4.4, 3.6],
		[10, 6.2, 5.6, 4.2],
	];
	for (const [cx, cy, rx, ry] of blobs)
		p.ellipse(cx, cy + 0.6, rx, ry, tones.shadow);
	for (const [cx, cy, rx, ry] of blobs) {
		p.ellipse(cx, cy, rx * 0.94, ry * 0.9, tones.base);
		p.shade(cx, cy, rx * 0.94, ry * 0.9, tones);
	}
	p.speckle(0, 0, 20, 18, tones.base, tones.highlight, 0.12, 21);
	p.speckle(0, 0, 20, 18, tones.base, tones.shadow, 0.12, 22);
	p.speckle(0, 0, 20, 18, tones.highlight, tones.base, 0.18, 23);
	if (blossom !== undefined) {
		for (const [x, y] of [
			[6, 11],
			[12, 7],
			[15, 12],
			[9, 14],
			[11, 10],
		] as const) {
			p.fine(x * SCENERY_K, y * SCENERY_K, blossom);
			p.fine(x * SCENERY_K + 1, y * SCENERY_K, blossom);
		}
	}
	return p.g;
}

function shrub(tones: GroundTonesLike, accent?: number): Grid {
	const p = pen(13, 10, SCENERY_K);
	p.ellipse(6.5, 6.4, 6.1, 3.7, tones.shadow);
	p.ellipse(6.5, 6, 5.7, 3.4, tones.base);
	p.shade(6.5, 6, 5.7, 3.4, tones);
	p.ellipse(3.5, 7, 2.6, 2, tones.base);
	p.ellipse(9.6, 7.2, 2.6, 2, tones.shadow);
	p.speckle(0, 0, 13, 10, tones.base, tones.highlight, 0.14, 31);
	p.speckle(0, 0, 13, 10, tones.base, tones.shadow, 0.1, 32);
	if (accent !== undefined) {
		for (const [x, y] of [
			[4, 4.2],
			[8, 5],
			[6, 7],
			[10, 7],
			[3, 7.2],
			[7, 3.5],
		] as const) {
			p.rect(x, y, 0.67, 0.67, accent);
		}
	}
	return p.g;
}

function rockSmall(stone: number, shadow: number, highlight: number): Grid {
	const p = pen(9, 6, SCENERY_K);
	p.ellipse(4.5, 3.6, 4.2, 2.4, shadow);
	p.ellipse(4.2, 3, 3.6, 2, stone);
	p.ellipse(3.4, 2.2, 1.4, 0.7, highlight);
	p.speckle(0, 0, 9, 6, stone, shadow, 0.08, 41);
	return p.g;
}

function boulder(
	stone: number,
	shadow: number,
	highlight: number,
	moss: number,
): Grid {
	const p = pen(15, 11, SCENERY_K);
	p.ellipse(7.5, 6.5, 7, 4.3, shadow);
	p.ellipse(7, 5.8, 6.3, 4, stone);
	p.ellipse(5, 4, 2.4, 1.4, highlight);
	p.ellipse(10, 3.2, 2.6, 1.2, moss);
	p.ellipse(12, 4.2, 0.8, 0.8, moss);
	p.rect(8, 7, 2, 0.67, shadow);
	p.speckle(0, 0, 15, 11, stone, shadow, 0.07, 51);
	p.speckle(0, 0, 15, 11, stone, highlight, 0.05, 52);
	return p.g;
}

function flowerPatch(
	a: number,
	b: number,
	c: number,
	center: number,
	stem: number,
): Grid {
	const p = pen(14, 9, SCENERY_K);
	const blooms: [number, number, number][] = [
		[2, 5, a],
		[5, 3, b],
		[8, 6, c],
		[11, 4, a],
		[4, 7, c],
		[10, 7, b],
		[7, 2, a],
		[12.5, 6.5, c],
		[1, 7.5, b],
	];
	for (const [x, y, color] of blooms) {
		p.rect(x + 0.33, y + 0.8, 0.34, 1.4, stem);
		p.ellipse(x + 0.5, y + 0.3, 0.95, 0.8, color);
		p.fine(
			Math.round((x + 0.5) * SCENERY_K),
			Math.round((y + 0.3) * SCENERY_K),
			center,
		);
	}
	return p.g;
}

function reeds(reed: number, tip: number, stem: number): Grid {
	const p = pen(9, 11, SCENERY_K);
	for (const [x, top] of [
		[1, 4],
		[2.4, 2],
		[3.6, 1],
		[5, 3],
		[6.3, 1.6],
		[7.4, 5],
	] as const) {
		p.rect(x, top, 0.67, 11 - top, Math.round(x * 3) % 2 === 0 ? stem : reed);
		p.rect(x - 0.1, top, 0.9, 1.8, tip);
	}
	return p.g;
}

/** Drawn at k=2 rather than SCENERY_K: eight of these make up a mushroom ring, which at full scenery size overlapped into one red blob. Same 2px cell density, smaller design. */
function mushroom(
	cap: number,
	capShadow: number,
	spot: number,
	stalk: number,
): Grid {
	const p = pen(6, 6, 2);
	p.rect(2.2, 3, 1.6, 3, stalk);
	p.ellipse(3, 2.5, 2.8, 1.8, capShadow);
	p.ellipse(3, 2.1, 2.6, 1.5, cap);
	p.rect(1.7, 1.2, 0.67, 0.67, spot);
	p.rect(3.8, 2, 0.67, 0.67, spot);
	p.rect(3, 0.9, 0.34, 0.34, spot);
	return p.g;
}

function fallenLog(
	wood: number,
	woodDark: number,
	woodLight: number,
	moss: number,
): Grid {
	const p = pen(24, 8, SCENERY_K);
	p.rect(3, 2, 18, 5, wood);
	p.rect(3, 6, 18, 1, woodDark);
	p.rect(3, 2, 18, 0.67, woodLight);
	for (let x = 5; x < 20; x += 2.6)
		p.rect(x, 3.4 + (x % 2) * 0.6, 1.6, 0.34, woodDark);
	p.ellipse(21, 4, 2.2, 2.6, woodLight);
	p.ellipse(21, 4, 1.4, 1.7, wood);
	p.ellipse(21, 4, 0.6, 0.7, woodDark);
	p.ellipse(2.5, 4, 2.2, 2.6, woodDark);
	p.ellipse(11, 2, 3, 1, moss);
	p.ellipse(16, 2.2, 1.2, 0.6, moss);
	p.speckle(3, 2, 18, 5, wood, woodDark, 0.06, 61);
	return p.g;
}

function stump(wood: number, woodDark: number, woodLight: number): Grid {
	const p = pen(10, 8, SCENERY_K);
	p.rect(2, 3, 6, 4, wood);
	p.rect(6.6, 3, 1.4, 4, woodDark);
	p.ellipse(5, 7, 4, 1, woodDark);
	p.ellipse(5, 3, 3.2, 1.4, woodLight);
	p.ellipse(5, 3, 1.8, 0.8, wood);
	p.ellipse(5, 3, 0.5, 0.3, woodDark);
	return p.g;
}

/** Two broken pillars and a fallen lintel — a "someone lived here once" beat for the edges, not a building the player can use. */
function ruin(
	stone: number,
	shadow: number,
	highlight: number,
	moss: number,
): Grid {
	const p = pen(30, 24, SCENERY_K);
	p.ellipse(15, 21.5, 14, 2.4, shadow);
	p.rect(3, 6, 5, 16, stone);
	p.rect(3, 6, 5, 0.67, highlight);
	p.rect(7, 6, 1, 16, shadow);
	p.rect(2, 4, 7, 2, stone);
	p.rect(2, 4, 7, 0.67, highlight);
	p.rect(2, 5.33, 7, 0.67, shadow);
	p.rect(21, 12, 5, 10, stone);
	p.rect(25, 12, 1, 10, shadow);
	p.tri(21, 12, 26, 12, 22.5, 9, stone);
	p.tri(22.5, 9, 26, 12, 24.5, 10.6, shadow);
	p.rect(11, 17, 8, 4, stone);
	p.rect(11, 17, 8, 0.67, highlight);
	p.rect(11, 20.3, 8, 0.7, shadow);
	// Coursed-masonry seams, the same banding language as the wizard tower.
	for (let y = 9; y < 21; y += 3) p.rect(3, y, 4, 0.34, shadow);
	for (let y = 14; y < 21; y += 3) p.rect(21, y, 4, 0.34, shadow);
	p.speckle(0, 0, 30, 24, stone, shadow, 0.05, 71);
	for (const [x, y, w] of [
		[3, 13.5, 1.6],
		[3.6, 15, 1],
		[3, 18, 1.4],
		[24, 16.5, 1],
		[24.6, 19, 1.4],
		[12, 16.8, 2],
		[16, 16.8, 1],
		[21.3, 12.4, 1],
	] as const) {
		p.rect(x, y, w, 0.67, moss);
	}
	return p.g;
}

/** The windmill's body only — the sails are a separate texture the engine rotates, the one moving thing on the edges. */
function windmillBody(
	plaster: number,
	plasterShadow: number,
	roof: number,
	roofShadow: number,
	wood: number,
	windowGlow: number,
): Grid {
	const p = pen(18, 30, SCENERY_K);
	p.tri(2, 29, 16, 29, 9, 8, plaster);
	p.rect(3, 12, 12, 17, plaster);
	p.tri(9, 8, 16, 29, 12, 29, plasterShadow);
	p.rect(12.5, 12, 2.5, 17, plasterShadow);
	p.tri(1, 13, 17, 13, 9, 2, roof);
	p.tri(9, 2, 17, 13, 9, 13, roofShadow);
	for (let y = 5; y < 13; y += 2)
		p.rect(9 - (y - 2) * 0.7, y, (y - 2) * 1.4, 0.34, roofShadow);
	p.rect(7, 22, 4, 7, wood);
	p.ellipse(9, 22, 2, 1.2, wood);
	p.rect(7.7, 15.6, 2.6, 3.4, wood);
	p.rect(8, 16, 2, 2.6, windowGlow);
	p.rect(1, 28.3, 16, 1.7, plasterShadow);
	return p.g;
}

function windmillSails(cloth: number, wood: number): Grid {
	const size = 31;
	const c = 15;
	const p = pen(size, size, SCENERY_K);
	p.rect(c, 0, 1, size, wood);
	p.rect(0, c, size, 1, wood);
	p.rect(c + 1, 1, 3, 12, cloth);
	p.rect(c - 3, size - 13, 3, 12, cloth);
	p.rect(1, c - 3, 12, 3, cloth);
	p.rect(size - 13, c + 1, 12, 3, cloth);
	for (let i = 2; i < 13; i += 2.5) {
		p.rect(c + 1, i, 3, 0.34, wood);
		p.rect(c - 3, size - 1 - i, 3, 0.34, wood);
		p.rect(i, c - 3, 0.34, 3, wood);
		p.rect(size - 1 - i, c + 1, 0.34, 3, wood);
	}
	p.ellipse(c + 0.5, c + 0.5, 1.6, 1.6, wood);
	return p.g;
}

function pond(
	water: number,
	deep: number,
	shine: number,
	shore: number,
	lily: number,
	petal: number,
): Grid {
	const p = pen(40, 24, SCENERY_K);
	p.ellipse(20, 12, 19.5, 11.5, shore);
	p.speckle(0, 0, 40, 24, shore, lily, 0.05, 81);
	p.ellipse(20, 12.4, 17.6, 9.8, water);
	p.speckle(3, 3, 34, 18, water, deep, 0.06, 82);
	p.rect(9, 9, 5, 0.34, shine);
	p.rect(10, 9.7, 2, 0.34, shine);
	p.rect(26, 16, 4, 0.34, shine);
	p.rect(14, 7, 2, 0.34, shine);
	for (const [x, y, r] of [
		[11, 15, 1.8],
		[29, 9, 1.8],
		[26, 12, 1.3],
		[13.2, 16.4, 1],
	] as const) {
		p.ellipse(x, y, r, r * 0.66, lily);
		p.rect(x, y - r * 0.66, 0.34, r * 0.66, water);
	}
	p.rect(29, 8.6, 0.67, 0.67, petal);
	return p.g;
}

/** A waymarker beside a path — a fine-density signpost for the edges, rather than scattering more of the coarse signpost prop. */
function waymarker(
	wood: number,
	woodDark: number,
	plank: number,
	ink: number,
): Grid {
	const p = pen(12, 18, SCENERY_K);
	p.rect(5, 5, 1.6, 13, wood);
	p.rect(6, 5, 0.6, 13, woodDark);
	p.tri(0.6, 3.5, 2, 1.6, 2, 5.4, plank);
	p.rect(2, 1.6, 9, 3.8, plank);
	p.tri(1.6, 9, 3, 7.4, 3, 10.6, plank);
	p.rect(3, 7.4, 7, 3.2, plank);
	p.rect(2, 5, 9, 0.34, woodDark);
	p.rect(3, 10.3, 7, 0.34, woodDark);
	for (let x = 3; x < 10; x += 1.4) p.rect(x, 3.2, 0.67, 0.67, ink);
	for (let x = 4; x < 9; x += 1.4) p.rect(x, 8.7, 0.67, 0.67, ink);
	return p.g;
}

export function buildScenery(p: SceneryPalette): SceneryPiece[] {
	const c = FINE_CELL_SIZE;
	return [
		{
			name: "pine",
			grid: pine(p.pineTones, p.trunk, p.trunkDark),
			cellSize: c,
		},
		{ name: "oak", grid: oak(p.oakTones, p.trunk, p.trunkDark), cellSize: c },
		{
			name: "blossom-oak",
			grid: oak(p.oakTones, p.trunk, p.trunkDark, p.blossom),
			cellSize: c,
		},
		{ name: "shrub", grid: shrub(p.shrubTones), cellSize: c },
		{ name: "berry-shrub", grid: shrub(p.shrubTones, p.berry), cellSize: c },
		{
			name: "rock-small",
			grid: rockSmall(p.stone, p.stoneShadow, p.stoneHighlight),
			cellSize: c,
		},
		{
			name: "boulder",
			grid: boulder(p.stone, p.stoneShadow, p.stoneHighlight, p.moss),
			cellSize: c,
		},
		{
			name: "flower-patch",
			grid: flowerPatch(p.petalA, p.petalB, p.petalC, p.petalCenter, p.stem),
			cellSize: c,
		},
		{ name: "reeds", grid: reeds(p.reed, p.reedTip, p.stem), cellSize: c },
		{
			name: "mushroom",
			grid: mushroom(p.capRed, p.capShadow, p.capSpot, p.stalk),
			cellSize: c,
		},
		{
			name: "fallen-log",
			grid: fallenLog(p.wood, p.woodDark, p.woodLight, p.moss),
			cellSize: c,
		},
		{
			name: "stump",
			grid: stump(p.wood, p.woodDark, p.woodLight),
			cellSize: c,
		},
		{
			name: "ruin",
			grid: ruin(p.stone, p.stoneShadow, p.stoneHighlight, p.moss),
			cellSize: c,
		},
		{
			name: "windmill",
			grid: windmillBody(
				p.plaster,
				p.plasterShadow,
				p.roof,
				p.roofShadow,
				p.woodDark,
				p.windowGlow,
			),
			cellSize: c,
		},
		{
			name: "windmill-sails",
			grid: windmillSails(p.sailCloth, p.woodDark),
			cellSize: c,
		},
		{
			name: "pond",
			grid: pond(p.water, p.waterDeep, p.waterShine, p.shore, p.lily, p.petalA),
			cellSize: c,
		},
		{
			name: "waymarker",
			grid: waymarker(p.wood, p.woodDark, p.plank, p.ink),
			cellSize: c,
		},
	];
}

// --- Horizon skyline -------------------------------------------------------

export interface SkylinePalette {
	/** Far layer (castle/towers/town) — hazy blue-gray, the atmospheric-perspective cue that it's miles off. */
	farStone: number;
	farStoneShadow: number;
	farStoneLight: number;
	farRoof: number;
	flag: number;
	hillTones: GroundTonesLike;
	treeTones: GroundTonesLike;
	/** Window cells take this in the separate lit-window layer; the day art shows them as `farStoneShadow`. */
	window: number;
}

export interface SkylinePiece {
	name: string;
	/** Everything, windows unlit. */
	grid: Grid;
	/** Window cells only (null elsewhere) — composited bright over the darkened night variant. */
	windows: Grid;
	cellSize: number;
}

interface WindowPen {
	add(x: number, y: number, w: number, h: number): void;
}

function windowPen(
	base: Pen,
	width: number,
	height: number,
	p: SkylinePalette,
): {
	grid: Grid;
	win: WindowPen;
} {
	const lit = pen(width, height, SKYLINE_K);
	return {
		grid: lit.g,
		win: {
			add: (x, y, w, h) => {
				lit.rect(x, y, w, h, p.window);
				base.rect(x, y, w, h, p.farStoneShadow);
			},
		},
	};
}

function spire(
	b: Pen,
	x: number,
	top: number,
	w: number,
	bottom: number,
	p: SkylinePalette,
	win: WindowPen,
	roofH: number,
): void {
	b.rect(x, top, w, bottom - top, p.farStone);
	b.rect(x + w - 1, top, 1, bottom - top, p.farStoneShadow);
	b.rect(x, top, 0.5, bottom - top, p.farStoneLight);
	b.tri(x - 1, top, x + w + 1, top, x + w / 2, top - roofH, p.farRoof);
	b.tri(
		x + w / 2,
		top - roofH,
		x + w + 1,
		top,
		x + w / 2,
		top,
		p.farStoneShadow,
	);
	win.add(x + w / 2 - 1, top + 3, 2, 3);
}

/** The kingdom's castle on the horizon — curtain wall, keep, four spires of different heights, and a pennant, drawn small and hazy so it reads as distant rather than as another prop. */
function castle(p: SkylinePalette): SkylinePiece {
	const w = 96;
	const h = 48;
	const b = pen(w, h, SKYLINE_K);
	const { grid: windows, win } = windowPen(b, w, h, p);

	b.rect(8, 32, 80, 16, p.farStone);
	b.rect(8, 44, 80, 4, p.farStoneShadow);
	for (let x = 8; x < 88; x += 4) b.rect(x, 30, 2, 2, p.farStone);
	for (let y = 35; y < 44; y += 3) b.rect(8, y, 80, 0.5, p.farStoneShadow);
	b.rect(34, 16, 28, 20, p.farStone);
	b.rect(58, 16, 4, 20, p.farStoneShadow);
	b.rect(34, 16, 28, 0.5, p.farStoneLight);
	for (let x = 34; x < 62; x += 4) b.rect(x, 14, 2, 2, p.farStone);
	for (let y = 20; y < 36; y += 3) b.rect(34, y, 24, 0.5, p.farStoneShadow);
	b.rect(44, 38, 8, 10, p.farStoneShadow);
	b.ellipse(48, 38, 4, 3, p.farStoneShadow);
	win.add(38, 22, 2, 4);
	win.add(46, 20, 4, 5);
	win.add(56, 22, 2, 4);
	win.add(40, 28, 2, 3);
	win.add(54, 28, 2, 3);
	win.add(16, 37, 2, 3);
	win.add(78, 37, 2, 3);
	win.add(26, 38, 2, 2);
	win.add(68, 38, 2, 2);

	spire(b, 6, 18, 8, 48, p, win, 9);
	spire(b, 82, 20, 8, 48, p, win, 8);
	spire(b, 28, 8, 6, 36, p, win, 8);
	spire(b, 62, 4, 7, 36, p, win, 10);
	b.rect(65.25, 0, 0.5, 5, p.farStoneShadow);
	b.tri(65.75, 0, 72, 1.5, 65.75, 3, p.flag);
	return { name: "castle", grid: b.g, windows, cellSize: FINE_CELL_SIZE };
}

function watchtower(p: SkylinePalette): SkylinePiece {
	const w = 14;
	const h = 34;
	const b = pen(w, h, SKYLINE_K);
	const { grid: windows, win } = windowPen(b, w, h, p);
	spire(b, 3, 10, 8, 34, p, win, 9);
	for (let y = 14; y < 34; y += 3) b.rect(3, y, 7, 0.5, p.farStoneShadow);
	win.add(6, 20, 2, 3);
	return { name: "watchtower", grid: b.g, windows, cellSize: FINE_CELL_SIZE };
}

/** A huddle of village rooftops at the castle's feet — lit windows at night are most of the skyline's "a kingdom lives here" warmth. */
function village(p: SkylinePalette): SkylinePiece {
	const w = 40;
	const h = 16;
	const b = pen(w, h, SKYLINE_K);
	const { grid: windows, win } = windowPen(b, w, h, p);
	const houses: [number, number, number][] = [
		[1, 8, 8],
		[8, 6, 9],
		[16, 9, 7],
		[22, 5, 10],
		[31, 8, 8],
	];
	for (const [x, top, hw] of houses) {
		b.rect(x, top + 3, hw, h - top - 3, p.farStone);
		b.rect(x + hw - 1, top + 3, 1, h - top - 3, p.farStoneShadow);
		b.tri(x - 1, top + 3, x + hw + 1, top + 3, x + hw / 2, top - 1, p.farRoof);
		win.add(x + hw / 2 - 1, top + 6, 2, 2);
	}
	b.rect(0, h - 2, w, 2, p.farStoneShadow);
	return { name: "village", grid: b.g, windows, cellSize: FINE_CELL_SIZE };
}

function hill(tones: GroundTonesLike): SkylinePiece {
	const w = 48;
	const h = 14;
	const b = pen(w, h, SKYLINE_K);
	b.ellipse(24, 16, 24, 14, tones.shadow);
	b.ellipse(22, 16, 21, 12.5, tones.base);
	b.ellipse(17, 9, 8, 3, tones.highlight);
	b.speckle(0, 0, w, h, tones.base, tones.shadow, 0.05, 91);
	return {
		name: "hill",
		grid: b.g,
		windows: createGrid(w * SKYLINE_K, h * SKYLINE_K),
		cellSize: FINE_CELL_SIZE,
	};
}

/** A clump of distant conifers — repeated along the band's base, this is the treeline the edge forest below it meets. */
function treeline(tones: GroundTonesLike): SkylinePiece {
	const w = 30;
	const h = 18;
	const b = pen(w, h, SKYLINE_K);
	const trees: [number, number, number][] = [
		[4, 6, 3.5],
		[10, 2, 4.5],
		[16, 5, 3.8],
		[22, 1, 5],
		[27, 7, 3.2],
	];
	for (const [cx, top, halfW] of trees) {
		b.tri(cx - halfW, h, cx + halfW, h, cx, top, tones.shadow);
		b.tri(cx - halfW + 1, h, cx, h, cx, top + 1, tones.base);
	}
	b.rect(0, h - 3, w, 3, tones.shadow);
	b.speckle(0, 0, w, h, tones.base, tones.highlight, 0.08, 92);
	return {
		name: "treeline",
		grid: b.g,
		windows: createGrid(w * SKYLINE_K, h * SKYLINE_K),
		cellSize: FINE_CELL_SIZE,
	};
}

export function buildSkyline(p: SkylinePalette): SkylinePiece[] {
	return [
		castle(p),
		watchtower(p),
		village(p),
		hill(p.hillTones),
		treeline(p.treeTones),
	];
}

export interface SkyOrnamentPalette {
	moonLight: number;
	moonMid: number;
	moonShadow: number;
	star: number;
	starCore: number;
}

export function buildMoon(p: SkyOrnamentPalette): Grid {
	const b = pen(14, 14, SKYLINE_K);
	b.ellipse(7, 7, 6.6, 6.6, p.moonMid);
	b.ellipse(6.4, 6.4, 5.9, 5.9, p.moonLight);
	b.ellipse(9, 9, 1.6, 1.4, p.moonMid);
	b.ellipse(5, 8.5, 1.1, 1, p.moonMid);
	b.ellipse(8, 4.5, 1, 0.9, p.moonMid);
	b.ellipse(4.6, 4.8, 0.6, 0.6, p.moonMid);
	b.ellipse(10.6, 10.4, 1, 0.8, p.moonShadow);
	return b.g;
}

export function buildStar(p: SkyOrnamentPalette): Grid {
	const g = createGrid(5, 5);
	setPixel(g, 2, 0, p.star);
	setPixel(g, 2, 4, p.star);
	setPixel(g, 0, 2, p.star);
	setPixel(g, 4, 2, p.star);
	fillRect(g, 1, 1, 3, 3, p.star);
	setPixel(g, 2, 2, p.starCore);
	return g;
}

// --- Path ribbon ------------------------------------------------------------

export interface PathRibbonPalette {
	edge: number;
	edgeShadow: number;
	bed: number;
	stone: number;
	stoneShadow: number;
	stoneHighlight: number;
}

/**
 * Round discs + individual cobbles replacing the rotated rectangular
 * cobble-strip stamps: render/pathBaker.ts draws every path in passes (all
 * edge discs, then all bed discs, then cobbles), so where segments meet the
 * ribbons union into one smooth shape with round corners instead of square
 * strip ends crossing each other. `edge-disc` is the sand border (wider),
 * `bed-disc` the mortar bed inside it. Authored directly at the fine cell
 * size.
 */
export function buildPathRibbon(p: PathRibbonPalette): {
	name: string;
	grid: Grid;
	cellSize: number;
}[] {
	const edge = createGrid(17, 17);
	fillEllipse(edge, 8.5, 8.5, 8.5, 8.5, p.edge);
	const bed = createGrid(12, 12);
	fillEllipse(bed, 6, 6, 6, 6, p.bed);
	const cobbles: Grid[] = [
		[4, 3],
		[3, 3],
		[4, 4],
		[3, 4],
	].map(([w = 3, h = 3]) => {
		const g = createGrid(w, h + 1);
		fillRect(g, 0, 1, w, h, p.stoneShadow);
		fillRect(g, 0, 0, w, h, p.stone);
		setPixel(g, 0, 0, p.stoneHighlight);
		setPixel(g, 1, 0, p.stoneHighlight);
		setPixel(g, w - 1, h - 1, p.stoneShadow);
		return g;
	});
	return [
		{ name: "edge-disc", grid: edge, cellSize: FINE_CELL_SIZE },
		{ name: "bed-disc", grid: bed, cellSize: FINE_CELL_SIZE },
		...cobbles.map((grid, i) => ({
			name: `cobble-${i}`,
			grid,
			cellSize: FINE_CELL_SIZE,
		})),
	];
}
