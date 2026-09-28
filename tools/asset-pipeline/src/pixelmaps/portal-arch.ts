import { hashNoise } from "../noise.js";
import type { PixelMap } from "../pixelmap.js";

// Grey-blue stone (steel gray 28 base, cool-shadow blue-gray 31 for shade
// and mortar, pale stone 58 for lit faces), a pale-ghost-blue rune inlay
// (30, bloom-friendly luminance) around the opening, moss accents for
// cottagecore warmth. Interior stays fully transparent — animation motes
// and the file-preview composite both draw into PORTAL_INTERIOR.
export const PORTAL_LEGEND: Record<string, number> = {
	O: 0, // darkest brown — silhouette outline
	L: 58, // pale stone — faces lit from the up-left
	S: 28, // steel gray — stone base
	s: 31, // cool shadow blue-gray — shaded faces
	k: 31, // cool shadow blue-gray — mortar joints
	v: 4, // dark green — moss shadow
	V: 9, // mid green — moss highlight
	r: 30, // pale ghost blue — glowing rune inlay
	R: 31, // cool shadow blue-gray — gap between rune glyphs
	m: 30, // pale ghost blue — animation mote
	M: 29, // bone/moonlight white — animation mote (bright core)
};

/**
 * Art-density pass (2026-09-28): redrawn on a grid 1.5x denser than the
 * original 32x32 arch, so the rendered 256px strip frame lands at the same
 * ~2 screen px per cell as the tower, cabins and props instead of reading as
 * a coarse checkerboard. Frame geometry is the original's, scaled: same
 * outer silhouette, same rectangular opening — PORTAL_OPENING_FRAME_PX (the
 * opening in the 256px strip frame the engine loads) is unchanged, which
 * the portal-preview renderer relies on.
 */
export const PORTAL_GRID = 48;
const ORIGINAL_GRID = 32;
const K = PORTAL_GRID / ORIGINAL_GRID;

/** Grid-cell bounds of the transparent opening, in portalArch's own coordinate space. */
export const PORTAL_INTERIOR = { x: 12, y: 15, width: 24, height: 33 };

/** The opening inside one PORTAL_ARCH_FRAME_SIZE (256px) strip frame — identical to the pre-2026-09-28 arch; the portal-preview code draws into exactly this rect. */
export const PORTAL_STRIP_FRAME_PX = 256;
export const PORTAL_OPENING_FRAME_PX = {
	x: 64,
	y: 80,
	width: 128,
	height: 176,
};

// Outer half-widths of the original arch head per original row (row-centre y
// -> half-width in original cells, centred on x=16); rows 10+ are the pillars.
const HEAD_PROFILE: readonly [number, number][] = [
	[2, 2.5],
	[2.5, 3],
	[3.5, 4],
	[4.5, 5],
	[5.5, 6],
	[6.5, 7],
	[7.5, 9],
	[8.5, 11],
	[9.5, 12],
	[10, 12],
];

function headHalfWidth(y: number): number {
	if (y < 2) return 0;
	for (let i = 1; i < HEAD_PROFILE.length; i++) {
		const [y1, w1] = HEAD_PROFILE[i] as [number, number];
		const [y0, w0] = HEAD_PROFILE[i - 1] as [number, number];
		if (y <= y1) return w0 + ((y - y0) / (y1 - y0)) * (w1 - w0);
	}
	return 12;
}

function inOpening(fx: number, fy: number): boolean {
	const o = PORTAL_INTERIOR;
	return fx >= o.x && fx < o.x + o.width && fy >= o.y && fy < o.y + o.height;
}

function inFrame(fx: number, fy: number): boolean {
	if (fx < 0 || fy < 0 || fx >= PORTAL_GRID || fy >= PORTAL_GRID) return false;
	if (inOpening(fx, fy)) return false;
	const cx = (fx + 0.5) / K;
	const cy = (fy + 0.5) / K;
	if (cy >= 10) return cx >= 4 && cx < 28;
	return Math.abs(cx - 16) < headHalfWidth(cy);
}

const KEYSTONE = { x0: 21, x1: 27 };

/** Which stone a cell belongs to (null = mortar joint): tall coursed blocks down the pillars, staggered ashlar courses across the head around one full-height keystone. */
function blockAt(fx: number, fy: number): number | null {
	if (fy >= PORTAL_INTERIOR.y) {
		const rel = fy - PORTAL_INTERIOR.y;
		if (rel % 6 === 5) return null;
		const side = fx < PORTAL_GRID / 2 ? 0 : 1;
		return 1000 + side * 100 + Math.floor(rel / 6);
	}
	if (fx === KEYSTONE.x0 - 1 || fx === KEYSTONE.x1) return null;
	if (fx >= KEYSTONE.x0 && fx < KEYSTONE.x1) return 500;
	const rel = PORTAL_INTERIOR.y - 1 - fy;
	if (rel % 4 === 3) return null;
	const course = Math.floor(rel / 4);
	const shifted = fx + (course % 2) * 4;
	if (shifted % 8 === 0) return null;
	return course * 100 + Math.floor(shifted / 8);
}

const MOSS_PATCHES: readonly [number, number, number, number][] = [
	[8, 45, 3, 4],
	[39, 44, 2.5, 3],
	[15, 8, 4, 2],
	[34, 12, 2.5, 1.6],
	[9, 30, 1.6, 2],
];

function inMoss(fx: number, fy: number): boolean {
	return MOSS_PATCHES.some(([cx, cy, rx, ry]) => {
		const nx = (fx + 0.5 - cx) / rx;
		const ny = (fy + 0.5 - cy) / ry;
		return nx * nx + ny * ny <= 1 && hashNoise(fx, fy, 20260928) < 0.75;
	});
}

function baseChar(fx: number, fy: number): string {
	if (!inFrame(fx, fy)) return ".";
	const touches = (test: (x: number, y: number) => boolean) =>
		test(fx - 1, fy) ||
		test(fx + 1, fy) ||
		test(fx, fy - 1) ||
		test(fx, fy + 1);
	const exterior = (x: number, y: number) => !inFrame(x, y) && !inOpening(x, y);
	if (touches(exterior)) return "O";
	if (touches(inOpening)) {
		// Rune glyph gaps every few cells so the inlay reads as carved runes,
		// not a plain glowing border.
		const along = fy >= PORTAL_INTERIOR.y ? fy : fx;
		return along % 5 === 0 ? "R" : "r";
	}
	const moss = inMoss(fx, fy);
	if (moss) {
		const lit = !inMoss(fx - 1, fy - 1) || !inMoss(fx, fy - 1);
		return lit ? "V" : "v";
	}
	const block = blockAt(fx, fy);
	if (block === null) return "k";
	const other = (x: number, y: number) =>
		!inFrame(x, y) || blockAt(x, y) !== block;
	if (other(fx - 1, fy) || other(fx, fy - 1)) return "L";
	if (other(fx + 1, fy) || other(fx, fy + 1)) return "s";
	return "S";
}

const BASE_ROWS: string[] = Array.from({ length: PORTAL_GRID }, (_, fy) =>
	Array.from({ length: PORTAL_GRID }, (_, fx) => baseChar(fx, fy)).join(""),
);

export const portalArch: PixelMap = {
	name: "portal_arch",
	width: PORTAL_GRID,
	height: PORTAL_GRID,
	legend: PORTAL_LEGEND,
	rows: BASE_ROWS,
};

export interface Mote {
	x: number;
	y: number;
	char: "m" | "M";
}

/**
 * Deterministic mote positions for a given animation frame: each mote orbits
 * the interior center at its own phase offset, advanced by frameIndex, with
 * a sinusoidal radius wobble so the swirl looks organic rather than a rigid
 * circle. Pure function of (frameIndex, totalFrames, moteCount) — same
 * inputs always produce the same positions.
 */
export function computeMotePositions(
	frameIndex: number,
	totalFrames: number,
	moteCount = 5,
): Mote[] {
	const cx = PORTAL_INTERIOR.x + Math.floor(PORTAL_INTERIOR.width / 2);
	const cy = PORTAL_INTERIOR.y + Math.floor(PORTAL_INTERIOR.height / 2);
	const rx = PORTAL_INTERIOR.width / 2 - 2;
	const ry = PORTAL_INTERIOR.height / 2 - 2;

	const motes: Mote[] = [];
	for (let m = 0; m < moteCount; m++) {
		const phase = (m / moteCount) * Math.PI * 2;
		const angle = phase + (frameIndex / totalFrames) * Math.PI * 2;
		const wobble = Math.sin(angle * 3 + m) * 0.15;
		const radiusScale = 0.55 + wobble;
		motes.push({
			x: Math.round(cx + Math.cos(angle) * rx * radiusScale),
			y: Math.round(cy + Math.sin(angle) * ry * radiusScale),
			char: (m + frameIndex) % 3 === 0 ? "M" : "m",
		});
	}
	return motes;
}

/** Renders one animation frame: the static stone arch with that frame's motes (2x2 cells each, keeping their old on-screen size at the finer grid) stamped into the still-empty interior. */
export function portalArchFrame(
	frameIndex: number,
	totalFrames: number,
	moteCount = 5,
): PixelMap {
	const rows = BASE_ROWS.map((row) => row.split(""));
	for (const { x, y, char } of computeMotePositions(
		frameIndex,
		totalFrames,
		moteCount,
	)) {
		for (const [dx, dy] of [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		] as const) {
			const row = rows[y + dy];
			const px = x + dx;
			if (!row || px < 0 || px >= row.length) continue;
			if (row[px] === ".") row[px] = char; // never overwrite stone, only empty interior
		}
	}
	return {
		name: `portal_arch_f${frameIndex}`,
		width: PORTAL_GRID,
		height: PORTAL_GRID,
		legend: PORTAL_LEGEND,
		rows: rows.map((row) => row.join("")),
	};
}
