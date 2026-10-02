import { hashNoise } from "../noise.js";
import {
	createGrid,
	type Grid,
	outlineGrid,
	setPixel,
} from "../pixel-shapes.js";

export interface WorldFountainPalette {
	ink: number;
	stoneLight: number;
	stone: number;
	stoneShadow: number;
	mossShadow: number;
	mossLight: number;
	rune: number;
	water: number;
	waterDeep: number;
	waterLight: number;
	sparkle: number;
	/** Neutral light/mid/dark tones for the gem overlay — tinted per world in the engine, so they should carry value, not hue. */
	gemLight: number;
	gemMid: number;
	gemDark: number;
	/** The socket's ring, painted in the (untinted) stone frame so the tinted gem always has a warm edge to read against. */
	gemBezel: number;
}

export const WORLD_FOUNTAIN_WIDTH = 56;
export const WORLD_FOUNTAIN_HEIGHT = 58;
export const WORLD_FOUNTAIN_FRAME_COUNT = 6;

const CX = 28;
const BASIN = { cy: 40, rx: 25, ry: 7, innerRx: 21, innerRy: 5, wall: 8 };
const WATER = { cy: 41, rx: 21, ry: 4.2 };
const COLUMN = { x0: 25, x1: 31, top: 17 };
const BOWL = { cy: 17, rx: 11, ry: 3, innerRx: 9, innerRy: 2, depth: 5 };
const FINIAL = { x0: 26, x1: 30, top: 9 };
const ORB = { cy: 6.5, r: 2.4 };
const GEM = { cy: 30, r: 2 };
/** Where each side's falling curtain leaves the upper bowl and lands in the basin. */
const CURTAIN = { fromY: 18, toY: 38, lipX: 11, landX: 14 };

function inEllipse(
	x: number,
	y: number,
	cy: number,
	rx: number,
	ry: number,
): boolean {
	const nx = (x + 0.5 - CX) / rx;
	const ny = (y + 0.5 - cy) / ry;
	return nx * nx + ny * ny <= 1;
}

/** Lower edge of the basin rim's outer ellipse at column x (fractional). */
function rimLowerEdge(x: number): number {
	const nx = (x + 0.5 - CX) / BASIN.rx;
	return BASIN.cy + BASIN.ry * Math.sqrt(Math.max(0, 1 - nx * nx));
}

function inFrontWall(x: number, y: number): boolean {
	if (Math.abs(x + 0.5 - CX) > BASIN.rx) return false;
	const top = rimLowerEdge(x) - 1;
	return y >= top && y < top + BASIN.wall;
}

function inRim(x: number, y: number): boolean {
	return (
		inEllipse(x, y, BASIN.cy, BASIN.rx, BASIN.ry) &&
		!inEllipse(x, y, BASIN.cy, BASIN.innerRx, BASIN.innerRy)
	);
}

function inBowlUnderside(x: number, y: number): boolean {
	if (y < BOWL.cy || y > BOWL.cy + BOWL.depth) return false;
	const half = BOWL.rx - (y - BOWL.cy) * 1.5;
	return Math.abs(x + 0.5 - CX) <= half;
}

/** Stone id for coursed masonry (null = mortar joint): courses `courseH` tall, blocks `blockW` wide, staggered half a block every other course. */
function masonryBlock(
	x: number,
	y: number,
	originY: number,
	courseH: number,
	blockW: number,
): number | null {
	const rel = y - originY;
	const course = Math.floor(rel / courseH);
	if (((rel % courseH) + courseH) % courseH === courseH - 1) return null;
	const shifted = x + (course % 2) * Math.floor(blockW / 2);
	if (shifted % blockW === 0) return null;
	return course * 1000 + Math.floor(shifted / blockW);
}

/** Up-left lit block shading: light where the block's own top/left edge is, shadow on its bottom/right. */
function shadeBlock(
	p: WorldFountainPalette,
	x: number,
	y: number,
	block: (x: number, y: number) => number | null,
	inside: (x: number, y: number) => boolean,
): number {
	const id = block(x, y);
	if (id === null) return p.stoneShadow;
	const other = (ox: number, oy: number) =>
		!inside(ox, oy) || block(ox, oy) !== id;
	if (other(x - 1, y) || other(x, y - 1)) return p.stoneLight;
	if (other(x + 1, y) || other(x, y + 1)) return p.stoneShadow;
	return p.stone;
}

const MOSS_PATCHES: readonly [number, number, number, number][] = [
	[7, 49, 3.2, 2.4],
	[46, 51, 2.6, 2],
	[18, 34.5, 3, 1.2],
	[19, 16, 2.2, 1],
	[31, 38, 1.4, 1.6],
];

function inMoss(x: number, y: number): boolean {
	return MOSS_PATCHES.some(([cx, cy, rx, ry]) => {
		const nx = (x + 0.5 - cx) / rx;
		const ny = (y + 0.5 - cy) / ry;
		return nx * nx + ny * ny <= 1 && hashNoise(x, y, 20260928) < 0.72;
	});
}

function paintStone(g: Grid, p: WorldFountainPalette): void {
	const W = WORLD_FOUNTAIN_WIDTH;
	const H = WORLD_FOUNTAIN_HEIGHT;

	// Basin: rim ring (segmented into long capstones), shadowed inner wall,
	// water, then the coursed front wall below the rim.
	const rimBlock = (x: number, y: number): number | null => {
		const angle = Math.atan2(
			(y + 0.5 - BASIN.cy) / BASIN.ry,
			(x + 0.5 - CX) / BASIN.rx,
		);
		const seg = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 14);
		const next = Math.floor(
			((Math.atan2((y + 0.5 - BASIN.cy) / BASIN.ry, (x + 1.5 - CX) / BASIN.rx) +
				Math.PI) /
				(Math.PI * 2)) *
				14,
		);
		return seg !== next && y < BASIN.cy + BASIN.ry - 1 ? null : seg;
	};
	const wallBlock = (x: number, y: number) =>
		masonryBlock(x, y, BASIN.cy, 4, 8);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (inFrontWall(x, y) && !inEllipse(x, y, BASIN.cy, BASIN.rx, BASIN.ry)) {
				setPixel(g, x, y, shadeBlock(p, x, y, wallBlock, inFrontWall));
			}
		}
	}
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (inRim(x, y)) setPixel(g, x, y, shadeBlock(p, x, y, rimBlock, inRim));
			else if (inEllipse(x, y, BASIN.cy, BASIN.innerRx, BASIN.innerRy)) {
				const water = inEllipse(x, y, WATER.cy, WATER.rx, WATER.ry);
				setPixel(g, x, y, water ? p.water : p.stoneShadow);
			}
		}
	}
	// Deeper water tone in the far half and around the column's foot.
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (!inEllipse(x, y, WATER.cy, WATER.rx, WATER.ry)) continue;
			if (inEllipse(x, y, WATER.cy - 1.4, WATER.rx - 3, WATER.ry - 1.8))
				setPixel(g, x, y, p.waterDeep);
		}
	}

	// Column, rising out of the water behind the bowl.
	const columnBlock = (x: number, y: number) =>
		masonryBlock(x, y, COLUMN.top, 4, 100);
	const inColumn = (x: number, y: number) =>
		x >= COLUMN.x0 &&
		x <= COLUMN.x1 &&
		y >= COLUMN.top &&
		y < WATER.cy - (x === COLUMN.x0 || x === COLUMN.x1 ? 0.5 : 0);
	for (let y = COLUMN.top; y < WATER.cy + 1; y++) {
		for (let x = COLUMN.x0; x <= COLUMN.x1; x++) {
			if (!inColumn(x, y)) continue;
			let c = shadeBlock(p, x, y, columnBlock, inColumn);
			if (x === COLUMN.x0) c = p.stoneLight;
			if (x === COLUMN.x1) c = p.stoneShadow;
			setPixel(g, x, y, c);
		}
	}
	// Carved rune inlay above and below the gem socket, glyph gaps every few
	// cells like the portal arch's opening border.
	for (let y = 21; y <= 37; y++) {
		if (Math.abs(y - GEM.cy) <= GEM.r + 1) continue;
		setPixel(g, CX, y, y % 3 === 0 ? p.stoneShadow : p.rune);
	}
	for (let y = GEM.cy - GEM.r - 1; y <= GEM.cy + GEM.r + 1; y++) {
		for (let x = CX - GEM.r - 1; x <= CX + GEM.r + 1; x++) {
			const d = Math.abs(x - CX) + Math.abs(y - GEM.cy);
			if (d === GEM.r + 1) setPixel(g, x, y, p.gemBezel);
			else if (d <= GEM.r) setPixel(g, x, y, p.rune);
		}
	}

	// Upper bowl: tapered underside, then its rim and water on top.
	const inBowlRim = (x: number, y: number) =>
		inEllipse(x, y, BOWL.cy, BOWL.rx, BOWL.ry) &&
		!inEllipse(x, y, BOWL.cy, BOWL.innerRx, BOWL.innerRy);
	for (let y = BOWL.cy; y <= BOWL.cy + BOWL.depth; y++) {
		for (let x = 0; x < W; x++) {
			if (!inBowlUnderside(x, y)) continue;
			const off = x + 0.5 - CX;
			const half = BOWL.rx - (y - BOWL.cy) * 1.5;
			let c = p.stone;
			if (off < -half + 1.5) c = p.stoneLight;
			else if (off > half - 2) c = p.stoneShadow;
			if (y === BOWL.cy + 2) c = p.stoneShadow;
			setPixel(g, x, y, c);
		}
	}
	for (let y = BOWL.cy - BOWL.ry - 1; y <= BOWL.cy + BOWL.ry + 1; y++) {
		for (let x = 0; x < W; x++) {
			if (inBowlRim(x, y)) {
				const lit =
					!inEllipse(x - 1, y, BOWL.cy, BOWL.rx, BOWL.ry) ||
					!inEllipse(x, y - 1, BOWL.cy, BOWL.rx, BOWL.ry);
				setPixel(
					g,
					x,
					y,
					lit ? p.stoneLight : (x + y) % 7 === 0 ? p.stoneShadow : p.stone,
				);
			} else if (inEllipse(x, y, BOWL.cy, BOWL.innerRx, BOWL.innerRy)) {
				setPixel(g, x, y, y < BOWL.cy ? p.stoneShadow : p.water);
			}
		}
	}

	// Finial post and orb.
	for (let y = FINIAL.top; y < BOWL.cy; y++) {
		for (let x = FINIAL.x0; x <= FINIAL.x1; x++) {
			let c = p.stone;
			if (x === FINIAL.x0) c = p.stoneLight;
			if (x === FINIAL.x1) c = p.stoneShadow;
			if (y === FINIAL.top || y === FINIAL.top + 4) c = p.stoneShadow;
			setPixel(g, x, y, c);
		}
	}
	for (let y = 0; y < FINIAL.top + 1; y++) {
		for (let x = 0; x < W; x++) {
			const dx = x + 0.5 - CX;
			const dy = y + 0.5 - ORB.cy;
			const d = Math.hypot(dx, dy);
			if (d > ORB.r) continue;
			const lit = dx + dy < -1.2;
			const shade = dx + dy > 1.4;
			setPixel(g, x, y, lit ? p.stoneLight : shade ? p.stoneShadow : p.stone);
		}
	}
	setPixel(g, CX - 1, Math.floor(ORB.cy) - 1, p.rune);

	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (g[y]?.[x] == null || !inMoss(x, y)) continue;
			const lit = !inMoss(x - 1, y - 1) || !inMoss(x, y - 1);
			setPixel(g, x, y, lit ? p.mossLight : p.mossShadow);
		}
	}
}

/** Water cell brightness cycling down the stream: `phase` advances one step per frame. */
function streamTone(
	p: WorldFountainPalette,
	along: number,
	phase: number,
): number {
	const k = (((along - phase * 2) % 6) + 6) % 6;
	return k < 2 ? p.waterLight : k < 4 ? p.water : p.waterDeep;
}

function paintWater(g: Grid, p: WorldFountainPalette, frame: number): void {
	const W = WORLD_FOUNTAIN_WIDTH;
	// Falling curtains off both sides of the bowl, curving slightly outward.
	for (const side of [-1, 1]) {
		for (let y = CURTAIN.fromY; y <= CURTAIN.toY; y++) {
			const t = (y - CURTAIN.fromY) / (CURTAIN.toY - CURTAIN.fromY);
			const off = CURTAIN.lipX + (CURTAIN.landX - CURTAIN.lipX) * Math.sqrt(t);
			const x = Math.round(CX - 0.5 + side * off);
			setPixel(g, x, y, streamTone(p, y, frame));
			setPixel(g, x - side, y, streamTone(p, y + 3, frame));
		}
	}
	// Expanding ripple rings where each curtain lands and around the column.
	const ripple = (cx: number, cy: number, rx: number, ry: number) => {
		for (let a = 0; a < 48; a++) {
			const ang = (a / 48) * Math.PI * 2;
			const x = Math.round(cx + Math.cos(ang) * rx - 0.5);
			const y = Math.round(cy + Math.sin(ang) * ry - 0.5);
			if (g[y]?.[x] === p.water || g[y]?.[x] === p.waterDeep)
				setPixel(g, x, y, p.waterLight);
		}
	};
	const growth = frame % 3;
	for (const side of [-1, 1]) {
		const cx = CX + side * CURTAIN.landX;
		ripple(cx, CURTAIN.toY + 1.5, 1.5 + growth * 1.2, 0.7 + growth * 0.45);
	}
	const colGrowth = frame % WORLD_FOUNTAIN_FRAME_COUNT;
	ripple(CX, WATER.cy, 5 + colGrowth * 1.8, 1.4 + colGrowth * 0.45);
	for (let i = 0; i < 3; i++) {
		const sx = Math.floor(hashNoise(i, frame, 7101) * W);
		const sy = Math.floor(
			WATER.cy - WATER.ry + hashNoise(i, frame, 7102) * WATER.ry * 2,
		);
		const here = g[sy]?.[sx];
		if (here === p.water || here === p.waterDeep)
			setPixel(g, sx, sy, p.sparkle);
	}
	const bowlSpark = Math.floor(hashNoise(frame, 3, 7103) * 12) - 6;
	if (g[BOWL.cy]?.[CX + bowlSpark] === p.water)
		setPixel(g, CX + bowlSpark, BOWL.cy, p.sparkle);
}

/** The orb's jet, painted after the outline: at one cell wide an inked droplet reads as a black speck, not water. */
function paintJet(g: Grid, p: WorldFountainPalette, frame: number): void {
	for (const side of [-1, 1]) {
		for (let i = 0; i <= 14; i++) {
			const t = i / 14;
			const x = Math.round(CX - 0.5 + side * (1 + t * 7));
			const y = Math.round(
				ORB.cy - 2.6 - 3 * Math.sin(t * Math.PI * 0.9) + t * 12,
			);
			if (y >= BOWL.cy - 1) break;
			const under = g[y]?.[x];
			if (under != null && under !== p.water) continue; // arcs behind the stone, never over it
			const k = (((i - frame * 2) % 6) + 6) % 6;
			if (k < 4) setPixel(g, x, y, k < 2 ? p.waterLight : p.water);
		}
	}
}

/**
 * The in-world directory marker (WorldScene's non-root clusters), replacing
 * the curio cabinet the round-2 playtest called out as "a little out of
 * place" next to the stone portal arches. Same stone language as the arch
 * (pixelmaps/portal-arch.ts): grey-blue coursed blocks lit from the
 * up-left, cool mortar, moss, a pale rune inlay — here running down the
 * column around a gem socket the engine fills with the world's theme color
 * (buildWorldFountainGem). Authored on the props' fine grid (2 screen px per
 * cell, drawn unscaled) with the structures' 1-cell ink outline. Frames
 * differ only in the water: streams cycling down the curtains and the jet,
 * ripple rings, a few sparkles.
 */
export function buildWorldFountainFrame(
	p: WorldFountainPalette,
	frame: number,
): Grid {
	const g = createGrid(WORLD_FOUNTAIN_WIDTH, WORLD_FOUNTAIN_HEIGHT);
	paintStone(g, p);
	paintWater(g, p, frame);
	outlineGrid(g, p.ink);
	paintJet(g, p, frame);
	return g;
}

/** The gem alone, on a transparent grid the size of a fountain frame, so the engine can overlay and tint it without tinting the stone. */
export function buildWorldFountainGem(p: WorldFountainPalette): Grid {
	const g = createGrid(WORLD_FOUNTAIN_WIDTH, WORLD_FOUNTAIN_HEIGHT);
	for (let y = GEM.cy - GEM.r; y <= GEM.cy + GEM.r; y++) {
		for (let x = CX - GEM.r; x <= CX + GEM.r; x++) {
			const dx = x - CX;
			const dy = y - GEM.cy;
			if (Math.abs(dx) + Math.abs(dy) > GEM.r) continue;
			const c = dx + dy < 0 ? p.gemLight : dx + dy > 0 ? p.gemDark : p.gemMid;
			setPixel(g, x, y, c);
		}
	}
	setPixel(g, CX - 1, GEM.cy - 1, p.gemLight);
	return g;
}
