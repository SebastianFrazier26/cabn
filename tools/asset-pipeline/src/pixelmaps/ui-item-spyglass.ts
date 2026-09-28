import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";
import { cylinderBand } from "./ui-icon-shading.js";

const WIDTH = 44;
const HEIGHT = 58;
// Eyepiece (flared bell, bottom-left) -> lens (round glass cap, top-right),
// same diagonal composition as letter_opener.png's blade.
const AX = 7;
const AY = 52;
const BX = 34;
const BY = 9;
const AXIS_DX = BX - AX;
const AXIS_DY = BY - AY;
const AXIS_LEN = Math.hypot(AXIS_DX, AXIS_DY);
const UX = AXIS_DX / AXIS_LEN;
const UY = AXIS_DY / AXIS_LEN;
const LENS_RADIUS = 4.8;
// Explicit ring seam positions along the axis (0..1) — v3 has room for four
// telescoping segments instead of v2's three, each with its own highlight
// lip just past the seam for a genuine "collapsible tube" read.
const RING_POSITIONS = [0.24, 0.42, 0.6, 0.78];

/**
 * Spyglass tool icon — a flared brass eyepiece tapering to a round glass
 * lens. v3: real ring segments (each with a highlight lip, not just a
 * shadow seam), 4-tone cylinder shading, and a proper round lens now that
 * the resolution is high enough for a radius-5 circle to read as a circle
 * rather than the diamond artifact v2 had at radius 2.
 */
export function buildSpyglassIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline / ring seams
		H: 13, // wood/bronze highlight — brightest band + ring lips
		b: 17, // bronze light
		B: 12, // bronze mid
		D: 2, // dark bronze — shadow band, eyepiece rim
		G: 30, // pale ghost blue — lens glass
		W: 29, // cream — lens glint
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 9, 54, 2);
	placeFlowerFleck(rows, 20, 50, 2);
	return {
		name: "ui_icon_spyglass",
		width: WIDTH,
		height: HEIGHT,
		legend,
		rows,
	};
}

function radiusAt(t: number): number {
	// Flares wide at the eyepiece (t=0) then quickly narrows — that flare
	// read is what makes it a spyglass and not a rod.
	if (t < 0.14) return 8.6 - (8.6 - 4.4) * (t / 0.14);
	return 4.4 - (4.4 - 2.2) * ((t - 0.14) / 0.86);
}

function pixelAt(x: number, y: number): string {
	const lensDist = Math.hypot(x - BX, y - BY);
	if (lensDist <= LENS_RADIUS) return lensChar(x, y, lensDist);

	const rx = x - AX;
	const ry = y - AY;
	const along = rx * UX + ry * UY;
	const perp = rx * -UY + ry * UX;
	// Stop the tube a couple pixels shy of the lens center so the lens disc
	// reads as plugged into the tube rather than floating past its end.
	if (along < -1 || along > AXIS_LEN - LENS_RADIUS * 0.5) return ".";

	const t = Math.max(0, Math.min(1, along / AXIS_LEN));
	const radius = radiusAt(t);
	if (Math.abs(perp) > radius) return ".";
	if (Math.abs(perp) > radius - 1.1) return "O";
	if (t < 0.08) return "D"; // eyepiece rim, in shadow

	for (const rp of RING_POSITIONS) {
		if (Math.abs(t - rp) < 0.015) return "O"; // ring seam shadow line
		if (t - rp > 0 && t - rp < 0.035) return "H"; // highlight lip just past the seam
	}

	const band = cylinderBand(perp, radius);
	return band === 3 ? "H" : band === 2 ? "b" : band === 1 ? "B" : "D";
}

function lensChar(x: number, y: number, dist: number): string {
	if (dist > LENS_RADIUS - 0.8) return "O";
	if (Math.hypot(x - (BX - 1.6), y - (BY - 1.6)) < 1.4) return "W"; // glint
	return "G";
}
