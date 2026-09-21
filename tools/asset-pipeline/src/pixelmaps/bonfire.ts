import type { PixelMap } from "../pixelmap.js";

// World-spawn marker: a low mound of stone ring around two crossed logs, with
// the flame drawn separately per-frame (see FLAME_ZONE below) the same way
// portal-arch.ts keeps its motes out of the static base. Stone reuses the
// portal arch's grey-blue palette (28 base / 31 shadow / 0 mortar) so the two
// world-anchor sprites read as the same material.
export const BONFIRE_LEGEND: Record<string, number> = {
	L: 2, // dark red-brown — log body
	l: 0, // darkest brown — log edge/shadow
	S: 28, // steel gray — stone base
	s: 31, // cool shadow blue-gray — stone shadow
	O: 0, // darkest brown — mortar / crevice between stones
	// Flame bands, coolest/darkest to hottest-looking, all warm oranges and
	// creams; the top two bands sit above soften()'s default bloom threshold
	// (180) so the flame glows outward once softened.
	a: 17, // ember orange (lum ~144) — flame base, hugging the logs
	b: 21, // body orange (lum ~166) — flame midsection
	c: 25, // bright orange-cream (lum ~189) — bloom-friendly
	d: 26, // pale cream (lum ~206) — bloom-friendly, flame tip
	e: 27, // palest cream (lum ~223) — bloom-friendly, hottest fleck
};

const BASE_ROWS: string[] = [
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"................................",
	"......LL................ll......",
	"......llLLL..........lllLL......",
	"......LLllLLL......lllLLll......",
	".......LLLlllLL..llLLLlll.......",
	"..........LLlllLLLLlll..........",
	"............LLLllLLL............",
	"..........llLLLLLllLLL..........",
	".......lllLLlll..LLlllLLL.......",
	"......lLLLlll......LLLllLL......",
	"......LLlll..........LLLll......",
	"......ll................LL......",
	"................................",
	"...OO.OSOOsSOsSSsSSOsSOOSO.OO...",
	"..ssSSsSSssSSsSSsSSssSSsSSssSS..",
	".OssSSSSSSSSSSSSSSSSSSSSSSssSSO.",
	"..SSSSSSSOSS.OOOOOO.SSOSSSSSSS..",
];

export const bonfire: PixelMap = {
	name: "bonfire",
	width: 32,
	height: 32,
	legend: BONFIRE_LEGEND,
	rows: BASE_ROWS,
};

// Column span the flame is allowed to occupy, in bonfire's own coordinate
// space — kept clear of stone/log pixels in BASE_ROWS above, shared with the
// frame generator below so both agree on where the fire "grows from" (its
// bottom row sits right at the logs' upper edge).
export const FLAME_ZONE = { x: 7, y: 2, width: 18, height: 16 };

const MAX_FLAME_HEIGHT = 15;
const MIN_FLAME_HEIGHT = 5;
const PRIMARY_FLICKER_AMPLITUDE = 2.4;
const SECONDARY_FLICKER_AMPLITUDE = 1.1;

/**
 * Deterministic per-column flame height for a given animation frame: a
 * rounded envelope (tallest at the zone's center, tapering at the edges)
 * modulated by two out-of-phase sine flickers so neighboring columns and
 * successive frames never move in lockstep. Pure function of
 * (column, frameIndex, totalFrames) — same inputs always produce the same
 * height, and frameIndex === totalFrames reproduces frameIndex === 0.
 */
export function computeFlameHeight(
	column: number,
	frameIndex: number,
	totalFrames: number,
): number {
	const half = (FLAME_ZONE.width - 1) / 2;
	const distance = Math.abs(column - half) / half;
	const envelope = MAX_FLAME_HEIGHT * (1 - distance ** 1.6);

	const phase = (frameIndex / totalFrames) * Math.PI * 2;
	const flicker =
		PRIMARY_FLICKER_AMPLITUDE * Math.sin(phase + column * 0.75) +
		SECONDARY_FLICKER_AMPLITUDE * Math.sin(phase * 2 + column * 1.35 + 1.7);

	const height = Math.round(envelope + flicker);
	return Math.max(MIN_FLAME_HEIGHT, Math.min(MAX_FLAME_HEIGHT, height));
}

/** Renders one animation frame: the static stone-and-logs base with that frame's flame stamped into the (still-empty) flame zone. */
export function bonfireFrame(
	frameIndex: number,
	totalFrames: number,
): PixelMap {
	const rows = BASE_ROWS.map((row) => row.split(""));
	const zoneBottom = FLAME_ZONE.y + FLAME_ZONE.height - 1;

	for (let column = 0; column < FLAME_ZONE.width; column++) {
		const height = computeFlameHeight(column, frameIndex, totalFrames);
		const x = FLAME_ZONE.x + column;

		for (let i = 0; i < height; i++) {
			const y = zoneBottom - i;
			const row = rows[y];
			if (!row || x < 0 || x >= row.length) continue;
			if (row[x] !== ".") continue; // never overwrite a log/stone pixel

			const t = i / height; // 0 at the base, ~1 at the tip
			row[x] =
				t < 0.3
					? "a"
					: t < 0.55
						? "b"
						: t < 0.8
							? "c"
							: i === height - 1 && height >= 10
								? "e"
								: "d";
		}
	}

	return {
		name: `bonfire_frame${frameIndex}`,
		width: 32,
		height: 32,
		legend: BONFIRE_LEGEND,
		rows: rows.map((row) => row.join("")),
	};
}
