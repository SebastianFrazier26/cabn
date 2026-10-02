import { hashNoise } from "../noise.js";
import {
	createMask,
	type Grid,
	type GroundTonesLike,
	maskEllipse,
	outlineGrid,
	paintFoliage,
} from "../pixel-shapes.js";
import { type Pen, pen } from "./pen.js";

export interface Prop {
	name: string;
	grid: Grid;
	/** Per-prop soften() cell size. */
	cellSize: number;
}

/**
 * Art-density pass (2026-09-28): every prop is authored on the same fine
 * grid as scenery.ts (base-unit design x PROP_K, rendered at soften cellSize
 * 2, drawn unscaled), replacing the old 6-screen-px-per-cell grids that read
 * as a second, chunkier art style next to the tower, cabins and scenery.
 * Base-unit dimensions are the old grids' own, so each prop's on-screen size
 * is unchanged (plus the outline's pad cell). Structures get the tower/
 * cabin's 1-cell ink outline; foliage stays outline-less like scenery's
 * trees and shrubs, where a shadow-tone rim does the edge work instead.
 */
export const PROP_CELL_SIZE = 2;
const PROP_K = 3;
const PAD = 1;
/** One fine cell, in base units. */
const F = 1 / PROP_K;

function propPen(width: number, height: number): Pen {
	return pen(width, height, PROP_K, PAD);
}

interface Ramp {
	light: number;
	base: number;
	dark: number;
}

/** Up-left lit block: a 1-fine-cell light top row and left column, dark bottom row and right column. */
function bevel(
	p: Pen,
	x: number,
	y: number,
	w: number,
	h: number,
	ramp: Ramp,
): void {
	p.rect(x, y, w, h, ramp.base);
	p.rect(x, y, w, F, ramp.light);
	p.rect(x, y, F, h, ramp.light);
	p.rect(x, y + h - F, w, F, ramp.dark);
	p.rect(x + w - F, y, F, h, ramp.dark);
}

/**
 * Coursed masonry over a base-unit box, the wizard tower's banding language
 * at fine density: courses `courseH` fine rows tall with a mortar row under
 * each, staggered vertical joints, a lit top row per course, and the right
 * `shadeFrac` of the box stepped one tone darker (light from the up-left).
 * Only recolors cells already filled, so it can texture any silhouette.
 */
function masonry(
	p: Pen,
	x: number,
	y: number,
	w: number,
	h: number,
	ramp: Ramp,
	mortar: number,
	courseH = 3,
	blockW = 6,
	shadeFrac = 0.22,
): void {
	const x0 = p.at(x);
	const y0 = p.at(y);
	const x1 = p.at(x + w);
	const y1 = p.at(y + h);
	const shadeX = x1 - Math.round((x1 - x0) * shadeFrac);
	for (let fy = y0; fy < y1; fy++) {
		const row = p.g[fy];
		if (!row) continue;
		const course = Math.floor((fy - y0) / (courseH + 1));
		const inCourse = (fy - y0) % (courseH + 1);
		for (let fx = x0; fx < x1; fx++) {
			if (row[fx] == null) continue;
			const joint = (fx - x0 + course * Math.ceil(blockW / 2)) % blockW === 0;
			if (inCourse === courseH || joint) {
				row[fx] = mortar;
				continue;
			}
			const shaded = fx >= shadeX;
			if (inCourse === 0) row[fx] = shaded ? ramp.base : ramp.light;
			else row[fx] = shaded ? ramp.dark : ramp.base;
		}
	}
}

const SENTINEL = -1;

interface RoofTones {
	edge: number;
	edgeLit: number;
	seam: number;
	shadow: number;
	base: number;
	highlight: number;
}

/** The shelf cabin's shingle treatment (3-row courses, staggered seams, lit left slope — see shelf-cabin.ts's drawRoof), for any triangular roof. */
function shingleRoof(
	p: Pen,
	x0: number,
	y0: number,
	x1: number,
	apexX: number,
	apexY: number,
	t: RoofTones,
): void {
	p.tri(x0, y0, x1, y0, apexX, apexY, SENTINEL);
	const apexFine = p.at(apexX);
	const top = p.at(apexY);
	const cells: [number, number][] = [];
	for (let fy = 0; fy < p.g.length; fy++) {
		const row = p.g[fy] ?? [];
		for (let fx = 0; fx < row.length; fx++)
			if (row[fx] === SENTINEL) cells.push([fx, fy]);
	}
	const isRoof = (fx: number, fy: number) => p.g[fy]?.[fx] === SENTINEL;
	const out = cells.map(([fx, fy]) => {
		const left = fx < apexFine;
		const course = Math.floor((fy - top) / 3);
		const rowIn = (fy - top) % 3;
		let idx: number;
		if (!isRoof(fx, fy - 1)) idx = left ? t.edgeLit : t.edge;
		else if (rowIn === 2) idx = (fx + course * 2) % 4 === 0 ? t.seam : t.shadow;
		else if (rowIn === 0 && left) idx = t.highlight;
		else idx = left || rowIn === 0 ? t.base : t.shadow;
		return idx;
	});
	cells.forEach(([fx, fy], i) => {
		const row = p.g[fy];
		if (row) row[fx] = out[i] ?? t.base;
	});
}

/** Scenery-style foliage clump: a shadow pass offset down, then lit base blobs, then fine leaf speckle — the same recipe as scenery.ts's oak/shrub. */
function foliage(
	p: Pen,
	blobs: readonly [number, number, number, number][],
	tones: GroundTonesLike,
	box: [number, number, number, number],
	seed: number,
): void {
	for (const [cx, cy, rx, ry] of blobs)
		p.ellipse(cx, cy + 0.6, rx, ry, tones.shadow);
	for (const [cx, cy, rx, ry] of blobs) {
		p.ellipse(cx, cy, rx * 0.94, ry * 0.9, tones.base);
		p.shade(cx, cy, rx * 0.94, ry * 0.9, tones);
	}
	const [bx, by, bw, bh] = box;
	p.speckle(bx, by, bw, bh, tones.base, tones.highlight, 0.12, seed);
	p.speckle(bx, by, bw, bh, tones.base, tones.shadow, 0.12, seed + 1);
	p.speckle(bx, by, bw, bh, tones.highlight, tones.base, 0.18, seed + 2);
}

function fence(wood: Ramp, ink: number): Grid {
	const p = propPen(20, 12);
	for (const ry of [4, 8]) {
		bevel(p, 0, ry, 20, 2, wood);
		for (let x = 1.4; x < 19; x += 3.1)
			p.rect(x, ry + 0.67 + ((x * 3) % 2) * F, 1.4, F, wood.dark);
	}
	for (const px of [2, 10, 18]) {
		const x = Math.min(px, 18.2);
		bevel(p, x, 2.2, 1.8, 9.8, wood);
		p.tri(x, 2.4, x + 1.8, 2.4, x + 0.9, 1.1, wood.base);
		p.tri(x, 2.4, x + 0.9, 2.4, x + 0.9, 1.1, wood.light);
		for (const ry of [4, 8]) p.rect(x + 0.67, ry + 0.67, F, F, ink);
	}
	outlineGrid(p.g, ink);
	return p.g;
}

function hedge(tones: GroundTonesLike): Grid {
	const p = propPen(22, 12);
	p.rect(1, 5.4, 20, 5.6, tones.shadow);
	p.rect(1.2, 5, 19.4, 5.2, tones.base);
	foliage(
		p,
		[
			[4, 5.2, 3.4, 2.6],
			[8.6, 4.6, 3.6, 2.8],
			[13.4, 4.8, 3.6, 2.7],
			[18, 5.4, 3.2, 2.5],
		],
		tones,
		[0, 0, 22, 12],
		101,
	);
	p.rect(1.2, 10, 19.4, 1, tones.shadow);
	p.speckle(0, 6, 22, 4, tones.base, tones.shadow, 0.08, 104);
	return p.g;
}

/** Glass-sided lamp with a bright core: the lit panes are bright/saturated on purpose — the night bloom threshold and light pools (render/effects.ts, propPlacement.ts's PROP_LIGHT_OFFSET) key off this spot, which stays at the old grid's glow position. */
function lampPost(
	wood: Ramp,
	ink: number,
	glow: number,
	glowBright: number,
): Grid {
	const p = propPen(8, 22);
	bevel(p, 1.8, 19.6, 4.4, 2.4, {
		light: wood.base,
		base: wood.dark,
		dark: ink,
	});
	p.rect(3.2, 8.4, 1.6, 11.4, wood.dark);
	p.rect(3.2, 8.4, F, 11.4, wood.base);
	p.rect(4.8 - F, 8.4, F, 11.4, ink);
	p.rect(2.4, 11, 3.2, F, wood.base);
	bevel(p, 2, 7.4, 4, 1, { light: wood.base, base: wood.dark, dark: ink });
	p.rect(1.2, 3, 5.6, 4.6, ink);
	p.rect(1.2 + F, 3 + F, 5.6 - 2 * F, 4.6 - 2 * F, glow);
	p.rect(2.8, 3.8, 2.4, 2.6, glowBright);
	p.rect(4 - F / 2, 3 + F, F, 4, ink);
	p.tri(0.4, 3.2, 7.6, 3.2, 4, 0.4, wood.dark);
	p.tri(0.4, 3.2, 4, 3.2, 4, 0.4, wood.base);
	p.rect(3.67, 0, 0.67, 0.67, wood.dark);
	outlineGrid(p.g, ink);
	return p.g;
}

/** Dry-stone wall: irregular stones in three staggered courses with shadowed mortar gaps, a cap course and a few moss tufts. */
function stoneWall(
	stone: Ramp,
	mortar: number,
	moss: GroundTonesLike,
	ink: number,
): Grid {
	const p = propPen(20, 10);
	p.rect(0, 2, 20, 8, mortar);
	const courses: [number, number, number[]][] = [
		[2.2, 2.3, [3.4, 4.2, 2.8, 3.9, 3.1, 2.6]],
		[4.8, 2.4, [2.2, 3.8, 4.4, 3, 3.6, 3]],
		[7.4, 2.3, [4, 3, 3.4, 4.2, 2.6, 2.8]],
	];
	for (const [y, h, widths] of courses) {
		let x = 0;
		for (const w of widths) {
			const bw = Math.min(w, 20 - x);
			if (bw <= F) break;
			bevel(p, x, y, bw - F, h - F, {
				light: stone.light,
				base: stone.base,
				dark: stone.dark,
			});
			x += w;
		}
	}
	p.speckle(0, 2, 20, 8, stone.base, stone.dark, 0.05, 121);
	for (const [x, w] of [
		[1.2, 2.4],
		[9, 1.6],
		[14.6, 2.8],
	] as const) {
		p.rect(x, 1.6, w, 0.67, moss.base);
		p.rect(x + F, 1.6, w * 0.5, F, moss.highlight);
		p.rect(x + w * 0.4, 2.27, w * 0.4, F, moss.shadow);
	}
	outlineGrid(p.g, ink);
	return p.g;
}

export interface CottageTones {
	plaster: number;
	plasterShadow: number;
	roof: RoofTones;
	wood: Ramp;
	stone: Ramp;
	stoneMortar: number;
	windowGlow: number;
	windowWarm: number;
	knob: number;
	petalA: number;
	petalB: number;
	leaf: GroundTonesLike;
	ink: number;
}

/**
 * Timber-framed village cottage matching the shelf cabin's roof, window and
 * door language. The left window and chimney keep the old grid's positions
 * — propPlacement.ts's PROP_LIGHT_OFFSET/PROP_SMOKE_OFFSET are fractions
 * hand-measured against them.
 */
function cottage(t: CottageTones): Grid {
	const p = propPen(20, 24);
	bevel(p, 14, 2.6, 3, 9.6, t.stone);
	masonry(p, 14, 2.6, 3, 9.6, t.stone, t.stoneMortar, 2, 4, 0.3);
	bevel(p, 13.6, 2, 3.8, 0.8, t.stone);

	p.rect(2, 12, 16, 10.4, t.plaster);
	p.rect(15, 12, 3, 10.4, t.plasterShadow);
	p.rect(2, 12.4, 16, 0.67, t.plasterShadow);
	for (const x of [2, 17.33]) p.rect(x, 12, 0.67, 10.4, t.wood.dark);
	p.rect(2, 16 - F, 5.67, F, t.wood.dark);
	p.rect(12.4, 16 - F, 5.6, F, t.wood.dark);
	p.rect(13.33, 16.67, 3, 3, t.wood.light);
	p.rect(13.67, 17, 2.33, 2.33, t.windowGlow);
	p.rect(13.67, 18.33, 2.33, 1, t.windowWarm);
	p.rect(14.67, 17, F, 2.33, t.wood.dark);
	p.rect(16, 17, F, 2.67, t.wood.base);

	bevel(p, 1.4, 22, 17.2, 1.6, t.stone);
	masonry(p, 1.4, 22, 17.2, 1.6, t.stone, t.stoneMortar, 3, 5, 0.25);

	shingleRoof(p, -0.2, 12.4, 20.2, 10, 1.4, t.roof);
	p.rect(0, 12.2, 20, 0.67, t.wood.dark);
	p.rect(0, 12.2, 20, F, t.wood.base);
	p.ellipse(10, 8.4, 1.5, 1.5, t.wood.light);
	p.ellipse(10, 8.4, 1, 1, t.windowGlow);
	p.rect(10 - F / 2, 7.4, F, 2, t.wood.dark);

	p.rect(7.67, 15.67, 4.67, 6.4, t.wood.light);
	p.rect(8, 16, 4, 6.4, t.wood.dark);
	p.rect(8, 16, 4, F, t.wood.light);
	p.rect(8.33, 16.33, F, 6, t.wood.base);
	for (const x of [9.33, 10.67]) p.rect(x, 16.33, F, 6, t.ink);
	for (const y of [17.33, 20.67]) p.rect(8, y, 1.67, F, t.ink);
	p.rect(11.33, 19, F, F, t.knob);

	p.rect(3.67, 13.67, 4.67, 4.67, t.wood.light);
	p.rect(4, 14, 4, 4, t.windowGlow);
	p.rect(4, 16.33, 4, 1.67, t.windowWarm);
	p.rect(6 - F / 2, 14, F, 4, t.wood.dark);
	p.rect(4, 16 - F / 2, 4, F, t.wood.dark);
	p.rect(8, 14, F, 4.33, t.wood.base);
	bevel(p, 3.4, 18.33, 5.2, 1, t.wood);
	for (let i = 0; i < 5; i++) {
		const x = 3.67 + i;
		p.rect(x, 17.67, 0.67, 0.67, t.leaf.base);
		p.rect(x, 17.67, F, F, t.leaf.highlight);
		if (i % 2 === 0) p.rect(x + F, 17.33, F, F, i % 4 ? t.petalB : t.petalA);
	}
	outlineGrid(p.g, t.ink);
	return p.g;
}

/** Planked raised bed with two alternating rows of blossoms rising over the back plank. */
function flowerBed(
	wood: Ramp,
	soil: number,
	soilDark: number,
	petalA: number,
	petalB: number,
	center: number,
	leaf: GroundTonesLike,
	ink: number,
): Grid {
	const p = propPen(16, 8);
	bevel(p, 0, 2.6, 16, 5.4, wood);
	p.rect(0.67, 3.33, 14.67, 3.67, soil);
	p.speckle(0, 3, 16, 4, soil, soilDark, 0.14, 131);
	for (let i = 0; i < 7; i++) {
		const x = 1.6 + i * 2;
		const back = i % 2 === 0;
		const top = back ? 1 : 2.6;
		p.rect(x + 0.33, top + 1, F, 3.6 - (top - 1), leaf.shadow);
		p.ellipse(x - 0.2, 5.2, 0.8, 0.6, leaf.base);
		p.ellipse(x + 1.1, 5, 0.8, 0.6, leaf.base);
		p.rect(x - 0.6, 4.8, F, F, leaf.highlight);
		p.ellipse(x + 0.5, top + 0.6, 0.95, 0.8, back ? petalA : petalB);
		p.fine(p.at(x + 0.5), p.at(top + 0.6), center);
	}
	outlineGrid(p.g, ink);
	return p.g;
}

/** Side-view park bench — two backrest slats between posts, a seat plank with a shadowed front edge, two legs. */
function bench(wood: Ramp, ink: number): Grid {
	const p = propPen(18, 12);
	const post: Ramp = { light: wood.base, base: wood.dark, dark: ink };
	for (const x of [1.2, 15.2]) bevel(p, x, 1.2, 1.6, 7, post);
	bevel(p, 0.6, 1.8, 16.8, 1.4, wood);
	bevel(p, 0.6, 3.8, 16.8, 1.4, wood);
	bevel(p, 0, 6, 18, 1.6, wood);
	p.rect(0, 7.6, 18, 0.8, wood.dark);
	for (const x of [2, 14.6]) bevel(p, x, 8.4, 1.4, 3.6, post);
	for (let x = 2; x < 17; x += 3.4) p.rect(x, 6.67, 1.4, F, wood.dark);
	outlineGrid(p.g, ink);
	return p.g;
}

export interface CastleTones {
	stone: Ramp;
	mortar: number;
	roof: Ramp;
	flag: number;
	windowGlow: number;
	windowWarm: number;
	wood: Ramp;
	ivy: GroundTonesLike;
	ink: number;
}

const CASTLE_K = 1.5;
const CASTLE_IVY_SEED = 20260928;

/**
 * A one-off decorative keep near the shelf's tower — deliberately squarer and
 * more crenellated than the wizard tower (a round, tapering silhouette) so
 * the two don't read as the same building at different sizes. Not part of
 * PROP_NAMES' random scatter pool; placed once, by name, near the tower, and
 * drawn at an explicit target height in ShelfScene (render/scale.ts's
 * CASTLE_KEEP_TARGET_HEIGHT_PX).
 *
 * Drawn at CASTLE_K rather than PROP_K: it's scaled down to its target
 * height in-engine, and 1.5x the old 32x44 design is what lands its fine
 * cells at the tower's own ~2.2 screen px after that scale.
 */
function castleKeep(t: CastleTones): Grid {
	const p = pen(32, 44, CASTLE_K, PAD);
	const cf = 1 / CASTLE_K;
	const bodyTop = 14;
	const bodyBottom = 41;
	const bodyLeft = 5;
	const bodyRight = 27;
	const bodyW = bodyRight - bodyLeft;

	p.rect(bodyLeft, bodyTop, bodyW, bodyBottom - bodyTop, t.stone.base);
	masonry(
		p,
		bodyLeft,
		bodyTop,
		bodyW,
		bodyBottom - bodyTop,
		t.stone,
		t.mortar,
		3,
		6,
		0.2,
	);
	p.rect(bodyLeft, bodyBottom - 2, bodyW, 2, t.stone.dark);
	p.rect(bodyLeft, bodyBottom - 2, bodyW, cf, t.stone.base);

	// Recessed parapet walkway with merlons poking up through it — the dark
	// gaps between merlons are what read as a real crenellated top rather
	// than a row of blocks glued to a flat roofline.
	const parapetY = bodyTop - 4;
	bevel(p, bodyLeft - 1, parapetY, bodyW + 2, 4, t.stone);
	p.rect(bodyLeft - 1, bodyTop - cf, bodyW + 2, cf, t.mortar);
	for (let x = bodyLeft - 1; x < bodyRight + 1; x += 4) {
		bevel(p, x, parapetY - 3, 2.67, 3, t.stone);
	}

	const turretLeft = 1;
	const turretWidth = 7;
	const turretTop = 7;
	p.rect(
		turretLeft,
		turretTop,
		turretWidth,
		bodyBottom - turretTop,
		t.stone.base,
	);
	masonry(
		p,
		turretLeft,
		turretTop,
		turretWidth,
		bodyBottom - turretTop,
		t.stone,
		t.mortar,
		3,
		5,
		0.3,
	);
	p.rect(turretLeft, turretTop, turretWidth, cf, t.stone.light);
	const apexX = turretLeft + turretWidth / 2;
	p.tri(
		turretLeft - 1,
		turretTop + 0.4,
		turretLeft + turretWidth + 1,
		turretTop + 0.4,
		apexX,
		1,
		t.roof.dark,
	);
	p.tri(
		turretLeft - 0.6,
		turretTop,
		apexX,
		turretTop,
		apexX,
		1.4,
		t.roof.light,
	);
	p.tri(
		apexX,
		turretTop,
		turretLeft + turretWidth + 0.6,
		turretTop,
		apexX,
		1.4,
		t.roof.base,
	);
	for (let y = 3; y < turretTop; y += 1.4)
		p.rect(apexX - (y - 1) * 0.6, y, (y - 1) * 1.2, cf, t.roof.dark);
	p.rect(apexX - cf / 2, 0, cf, 1.6, t.ink);
	p.tri(apexX + cf / 2, 0, apexX + 6, 1.2, apexX + cf / 2, 2.4, t.flag);
	p.rect(apexX + cf / 2, 1.8, 4, cf, t.roof.dark);

	for (const wx of [bodyLeft + 4, bodyRight - 6, turretLeft + 2.5]) {
		const wy = wx === turretLeft + 2.5 ? turretTop + 6 : bodyTop + 12;
		p.rect(wx - cf, wy - cf, 2 + 2 * cf, 5.4 + cf, t.ink);
		p.ellipse(wx + 1, wy, 1 + cf, 1 + cf, t.ink);
		p.ellipse(wx + 1, wy + 0.2, 1, 0.9, t.windowGlow);
		p.rect(wx, wy, 2, 5, t.windowGlow);
		p.rect(wx, wy + 3, 2, 2, t.windowWarm);
	}

	const doorX = bodyLeft + bodyW / 2 - 3;
	const doorY = bodyBottom - 9;
	p.ellipse(doorX + 3, doorY + 0.4, 3.6, 3, t.stone.light);
	p.rect(doorX - 0.6, doorY, 7.2, 9, t.stone.light);
	p.ellipse(doorX + 3, doorY + 0.6, 3, 2.6, t.wood.dark);
	p.rect(doorX, doorY + 0.6, 6, 8.4, t.wood.dark);
	for (const x of [doorX + 2, doorX + 4]) p.rect(x, doorY - 1, cf, 10, t.ink);
	p.rect(doorX + cf, doorY - 1, cf, 10, t.wood.base);
	for (const y of [doorY + 1.6, doorY + 6.4]) p.rect(doorX, y, 6, cf, t.ink);

	const ivy = createMask(p.g[0]?.length ?? 0, p.g.length);
	const onKeep = (fx: number, fy: number) => p.g[fy]?.[fx] != null;
	const ragged = (thr: number) => (fx: number, fy: number) =>
		onKeep(fx, fy) && hashNoise(fx, fy, CASTLE_IVY_SEED) < thr;
	for (let y = bodyTop + 8; y < bodyBottom; y += 2) {
		const wiggle = Math.sin(y * 0.5) * 1.2;
		maskEllipse(
			ivy,
			p.at(bodyRight - 2 + wiggle),
			p.at(y),
			2.4,
			2,
			ragged(0.8),
		);
	}
	maskEllipse(
		ivy,
		p.at(bodyRight - 3),
		p.at(bodyBottom - 2),
		5,
		3,
		ragged(0.85),
	);
	maskEllipse(
		ivy,
		p.at(turretLeft + 1.5),
		p.at(bodyBottom - 3),
		3,
		4,
		ragged(0.8),
	);
	paintFoliage(p.g, ivy, t.ivy);

	outlineGrid(p.g, t.ink);
	return p.g;
}

/** Shared by tree-small/tree-large: scenery.ts's oak recipe, generalized to any footprint so the scattered trees and the edge forest read as the same species. */
function roundCanopyTree(
	width: number,
	height: number,
	trunk: Ramp,
	tones: GroundTonesLike,
	blossom: number | undefined,
	seed: number,
): Grid {
	const p = propPen(width, height);
	const trunkW = Math.max(2, width * 0.16);
	const trunkH = height * 0.34;
	const tx = width / 2 - trunkW / 2;
	p.rect(tx, height - trunkH, trunkW, trunkH, trunk.base);
	p.rect(tx, height - trunkH, F, trunkH, trunk.light);
	p.rect(
		tx + trunkW - trunkW * 0.35,
		height - trunkH,
		trunkW * 0.35,
		trunkH,
		trunk.dark,
	);
	p.tri(
		tx - 1.2,
		height,
		tx + trunkW + 1.2,
		height,
		width / 2,
		height - 2.4,
		trunk.base,
	);
	p.tri(
		width / 2,
		height - 2.4,
		tx + trunkW + 1.2,
		height,
		width / 2,
		height,
		trunk.dark,
	);

	const cy = height - trunkH - height * 0.26;
	const rx = width * 0.44;
	const ry = height * 0.26;
	const blobs: [number, number, number, number][] = [
		[width / 2, cy, rx, ry],
		[width * 0.27, cy + ry * 0.35, rx * 0.55, ry * 0.6],
		[width * 0.73, cy + ry * 0.35, rx * 0.55, ry * 0.6],
		[width / 2, cy - ry * 0.8, rx * 0.62, ry * 0.6],
	];
	foliage(p, blobs, tones, [0, 0, width, height - trunkH + 1], seed);
	if (blossom !== undefined) {
		for (const [fx, fy] of [
			[0.3, 0.35],
			[0.6, 0.18],
			[0.74, 0.46],
			[0.4, 0.55],
			[0.52, 0.34],
			[0.22, 0.52],
		] as const) {
			const x = p.at(width * fx);
			const y = p.at(fy * (height - trunkH));
			p.fine(x, y, blossom);
			p.fine(x + 1, y, blossom);
		}
	}
	return p.g;
}

function bush(tones: GroundTonesLike, accent: number | undefined): Grid {
	const p = propPen(14, 10);
	foliage(
		p,
		[
			[7, 5.4, 6, 3.6],
			[3.8, 6.6, 3, 2.4],
			[10.2, 6.6, 3, 2.4],
		],
		tones,
		[0, 0, 14, 10],
		141,
	);
	if (accent !== undefined) {
		for (const [x, y] of [
			[5, 4],
			[8.6, 4.6],
			[3.4, 6.6],
			[10.4, 6.4],
		] as const)
			p.rect(x, y, 0.67, 0.67, accent);
	}
	return p.g;
}

export interface WellTones {
	stone: Ramp;
	mortar: number;
	wood: Ramp;
	roof: RoofTones;
	rope: number;
	water: number;
	waterShine: number;
	ink: number;
}

function well(t: WellTones): Grid {
	const p = propPen(16, 20);
	for (const x of [1.2, 13.2]) bevel(p, x, 3.4, 1.6, 10.6, t.wood);
	bevel(p, 1.2, 5, 13.6, 1, t.wood);
	p.rect(7.83, 6, F, 3, t.rope);
	bevel(p, 6.8, 8.8, 2.4, 2, t.wood);
	p.rect(6.8, 9.4, 2.4, F, t.ink);

	p.ellipse(8, 14.6, 7.3, 4.9, t.mortar);
	p.ellipse(8, 14.2, 7, 4.6, t.stone.base);
	masonry(p, 0, 14, 16, 6, t.stone, t.mortar, 2, 5, 0.25);
	p.ellipse(8, 12.6, 6.4, 2.6, t.stone.light);
	p.ellipse(8, 12.8, 5.4, 1.9, t.stone.base);
	p.ellipse(8, 12.9, 4.8, 1.6, t.water);
	p.rect(5.4, 12.4, 1.6, F, t.waterShine);
	p.rect(9.6, 13.4, 1, F, t.waterShine);

	shingleRoof(p, -0.2, 4, 16.2, 8, 0.2, t.roof);
	p.rect(0, 3.8, 16, 0.67, t.wood.dark);
	outlineGrid(p.g, t.ink);
	return p.g;
}

function signpost(
	wood: Ramp,
	plank: number,
	plankShadow: number,
	ink: number,
): Grid {
	const p = propPen(10, 18);
	p.rect(4.2, 5, 1.6, 13, wood.base);
	p.rect(4.2, 5, F, 13, wood.light);
	p.rect(5.4, 5, 0.4, 13, wood.dark);
	p.rect(0.3, 1.8, 8, 3.6, plank);
	p.tri(8.3, 1.8, 8.3, 5.4, 9.9, 3.6, plank);
	p.rect(0.3, 5.4 - F, 8, F, plankShadow);
	p.tri(8.3, 5.4 - F, 8.3, 5.4, 9.6, 3.8, plankShadow);
	p.tri(0.1, 8.9, 1.7, 7.2, 1.7, 10.6, plank);
	p.rect(1.7, 7.2, 7.4, 3.4, plank);
	p.rect(1.7, 10.6 - F, 7.4, F, plankShadow);
	p.speckle(0, 1.8, 10, 9, plank, plankShadow, 0.06, 151);
	for (let x = 1.2; x < 8; x += 1.4) p.rect(x, 3.4, 0.67, 0.67, ink);
	for (let x = 2.8; x < 8.4; x += 1.4) p.rect(x, 8.6, 0.67, 0.67, ink);
	p.rect(4.67, 2.4, F, F, wood.dark);
	p.rect(4.67, 7.8, F, F, wood.dark);
	outlineGrid(p.g, ink);
	return p.g;
}

function flowerPot(
	pot: Ramp,
	dirt: number,
	petal: number,
	petalAlt: number,
	center: number,
	leaf: GroundTonesLike,
	ink: number,
): Grid {
	const p = propPen(10, 14);
	p.tri(2.2, 9.6, 7.8, 9.6, 7.2, 13.8, pot.base);
	p.tri(2.2, 9.6, 2.8, 13.8, 7.2, 13.8, pot.base);
	p.rect(2.6, 9.6, F, 4, pot.light);
	p.tri(6.2, 9.6, 7.8, 9.6, 7.2, 13.8, pot.dark);
	bevel(p, 1.6, 8.4, 6.8, 1.4, pot);
	p.rect(2, 8.4, 6, F, dirt);

	for (const [sx, top] of [
		[3.2, 4.6],
		[5.2, 3.4],
		[7, 5],
	] as const)
		p.rect(sx, top + 0.6, F, 8.4 - top - 0.6, leaf.shadow);
	foliage(
		p,
		[
			[3.6, 7.4, 2, 1.2],
			[6.6, 7.2, 2, 1.3],
		],
		leaf,
		[0, 5, 10, 4],
		161,
	);
	for (const [x, y, c] of [
		[3.2, 4.2, petal],
		[5.2, 3, petalAlt],
		[7, 4.6, petal],
	] as const) {
		p.ellipse(x + F / 2, y, 1.2, 1, c);
		p.fine(p.at(x), p.at(y) - 1, center);
		p.fine(p.at(x), p.at(y), center);
	}
	outlineGrid(p.g, ink);
	return p.g;
}

export interface PropPaletteIndices {
	ink: number;
	wood: number;
	woodDark: number;
	woodLight: number;
	hedgeTones: GroundTonesLike;
	stone: number;
	stoneShadow: number;
	stoneHighlight: number;
	glow: number;
	glowBright: number;
	treeTones: GroundTonesLike;
	blossomAccent: number;
	bushTones: GroundTonesLike;
	waterDark: number;
	waterShine: number;
	plankCream: number;
	plankShadow: number;
	potColor: number;
	potShadow: number;
	potLight: number;
	dirt: number;
	petal: number;
	petalAlt: number;
	petalCenter: number;
	plaster: number;
	plasterShadow: number;
	roofColor: number;
	roofShadow: number;
	roofHighlight: number;
	windowGlow: number;
	windowWarm: number;
	knob: number;
	bedSoil: number;
	flagColor: number;
	turretRoof: Ramp;
}

function ramps(idx: PropPaletteIndices) {
	const wood: Ramp = {
		light: idx.woodLight,
		base: idx.wood,
		dark: idx.woodDark,
	};
	const stone: Ramp = {
		light: idx.stoneHighlight,
		base: idx.stone,
		dark: idx.stoneShadow,
	};
	const roof: RoofTones = {
		edge: idx.wood,
		edgeLit: idx.woodLight,
		seam: idx.woodDark,
		shadow: idx.roofShadow,
		base: idx.roofColor,
		highlight: idx.roofHighlight,
	};
	return { wood, stone, roof };
}

/** The random-scatter prop pool — see gen-world-art.ts's castleKeep call for the one-off shelf accent that's deliberately *not* in this list. */
export function buildProps(idx: PropPaletteIndices): Prop[] {
	const { wood, stone, roof } = ramps(idx);
	const c = PROP_CELL_SIZE;
	const trunk: Ramp = { light: idx.wood, base: idx.woodDark, dark: idx.ink };
	return [
		{ name: "fence", grid: fence(wood, idx.ink), cellSize: c },
		{ name: "hedge", grid: hedge(idx.hedgeTones), cellSize: c },
		{
			name: "lamp-post",
			grid: lampPost(wood, idx.ink, idx.glow, idx.glowBright),
			cellSize: c,
		},
		{
			name: "tree-small",
			grid: roundCanopyTree(
				16,
				24,
				trunk,
				idx.treeTones,
				idx.blossomAccent,
				171,
			),
			cellSize: c,
		},
		{
			name: "tree-large",
			grid: roundCanopyTree(22, 34, trunk, idx.treeTones, undefined, 181),
			cellSize: c,
		},
		{ name: "bush", grid: bush(idx.bushTones, undefined), cellSize: c },
		{
			name: "well",
			grid: well({
				stone,
				mortar: idx.stoneShadow,
				wood,
				roof,
				rope: idx.plankCream,
				water: idx.waterDark,
				waterShine: idx.waterShine,
				ink: idx.ink,
			}),
			cellSize: c,
		},
		{
			name: "signpost",
			grid: signpost(wood, idx.plankCream, idx.plankShadow, idx.ink),
			cellSize: c,
		},
		{
			name: "flower-pot",
			grid: flowerPot(
				{ light: idx.potLight, base: idx.potColor, dark: idx.potShadow },
				idx.dirt,
				idx.petal,
				idx.petalAlt,
				idx.petalCenter,
				idx.bushTones,
				idx.ink,
			),
			cellSize: c,
		},
		{
			name: "stone-wall",
			grid: stoneWall(stone, idx.stoneShadow, idx.hedgeTones, idx.ink),
			cellSize: c,
		},
		{
			name: "cottage",
			grid: cottage({
				plaster: idx.plaster,
				plasterShadow: idx.plasterShadow,
				roof,
				wood,
				stone,
				stoneMortar: idx.stoneShadow,
				windowGlow: idx.windowGlow,
				windowWarm: idx.windowWarm,
				knob: idx.knob,
				petalA: idx.petal,
				petalB: idx.petalAlt,
				leaf: idx.hedgeTones,
				ink: idx.ink,
			}),
			cellSize: c,
		},
		{
			name: "flower-bed",
			grid: flowerBed(
				wood,
				idx.bedSoil,
				idx.woodDark,
				idx.petal,
				idx.petalAlt,
				idx.petalCenter,
				idx.hedgeTones,
				idx.ink,
			),
			cellSize: c,
		},
		{ name: "bench", grid: bench(wood, idx.ink), cellSize: c },
	];
}

export function buildCastleKeep(idx: PropPaletteIndices): Prop {
	const { wood, stone } = ramps(idx);
	return {
		name: "castle-keep",
		grid: castleKeep({
			stone,
			mortar: idx.stoneShadow,
			roof: idx.turretRoof,
			flag: idx.flagColor,
			windowGlow: idx.windowGlow,
			windowWarm: idx.windowWarm,
			wood,
			ivy: idx.hedgeTones,
			ink: idx.ink,
		}),
		cellSize: PROP_CELL_SIZE,
	};
}
