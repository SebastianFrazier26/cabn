import type { PixelMap } from "../pixelmap.js";

// v2: weathered stone archway (was wood-and-glow). Multiple gray/steel tones
// from the curated palette (28 steel, 23 warm gray, 22 khaki) give it a
// textured, weathered look; a pale-ghost-blue rune line (30, bloom-friendly
// luminance) runs along the inner edge of the stone as a glowing inlay, with
// a cool-shadow-blue-gray (31) line underneath for contrast. Interior stays
// fully transparent — animation motes and the file-preview composite both
// draw into PORTAL_INTERIOR.
export const PORTAL_LEGEND: Record<string, number> = {
	O: 0, // darkest brown — mortar / deep crevice
	S: 28, // steel gray — stone base
	s: 23, // warm gray — stone highlight
	k: 22, // khaki — weathered stone patch
	v: 4, // dark green — moss shadow
	V: 9, // mid green — moss highlight
	r: 30, // pale ghost blue — glowing rune inlay
	R: 31, // cool shadow blue-gray — rune shadow
	m: 30, // pale ghost blue — animation mote
	M: 29, // bone/moonlight white — animation mote (bright core)
};

const BASE_ROWS: string[] = [
	"................................",
	"................................",
	".............OrkkrO.............",
	".........v..ORkSSkRO..v.........",
	"........Vv.OrSSSSSSrOvV.........",
	"........v.OrSSSSSSSSrO.v........",
	".....V...ORSkksSSskkSRO...v.....",
	"....v..OrSsSSSSSSSSSSsSrO..V....",
	".....OrSSSSksSSSSSSskSSSSrO.....",
	"....ORkSSSSkssSSSSsskSSSSkRO....",
	"....OSSr................rSSO....",
	"....OkSr................rSkO....",
	"....OkkR................RkkO....",
	"....OSSr................rSSO....",
	"....OSSr................rSSO....",
	"....Oskr................rksO....",
	"....OksR................RskO....",
	"....OSSr................rSSO....",
	"....OSSr................rSvO....",
	"....OSSr................rSSO....",
	"....OkvR................RSkO....",
	"....Okkr................rkkO....",
	"....OSSr................rSSO....",
	"....OSSr................rSSO....",
	"....OSSR................RvSO....",
	"....OSSr................rSSO....",
	"....OSSr................rSVO....",
	"....Oksr................rskO....",
	"....OSSR................RSSO....",
	"....OSSr................rSSO....",
	"....OSSr................rSSO....",
	"....OSkr................rkSO....",
];

export const portalArch: PixelMap = {
	name: "portal_arch",
	width: 32,
	height: 32,
	legend: PORTAL_LEGEND,
	rows: BASE_ROWS,
};

// Grid-cell bounds of the transparent opening, in portalArch's own
// coordinate space — shared with the animation frame generator and the
// portal-preview composite script so both draw into the same hole.
export const PORTAL_INTERIOR = { x: 8, y: 10, width: 16, height: 22 };

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
	const cx = PORTAL_INTERIOR.x + PORTAL_INTERIOR.width / 2;
	const cy = PORTAL_INTERIOR.y + PORTAL_INTERIOR.height / 2;
	const rx = PORTAL_INTERIOR.width / 2 - 1;
	const ry = PORTAL_INTERIOR.height / 2 - 1;

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

/** Renders one animation frame: the static stone arch with that frame's motes stamped into the (still-empty) interior. */
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
		const row = rows[y];
		if (!row || x < 0 || x >= row.length) continue;
		if (row[x] === ".") row[x] = char; // never overwrite stone, only empty interior
	}
	return {
		name: `portal_arch_f${frameIndex}`,
		width: 32,
		height: 32,
		legend: PORTAL_LEGEND,
		rows: rows.map((row) => row.join("")),
	};
}
