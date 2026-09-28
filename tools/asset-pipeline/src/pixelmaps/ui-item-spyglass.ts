import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 20;
const HEIGHT = 28;
// Eyepiece (flared bell, bottom-left) -> lens (narrow tip, top-right), same
// diagonal composition as letter_opener.png's blade.
const AX = 3;
const AY = 25;
const BX = 16;
const BY = 4;
const AXIS_DX = BX - AX;
const AXIS_DY = BY - AY;
const AXIS_LEN = Math.hypot(AXIS_DX, AXIS_DY);
const UX = AXIS_DX / AXIS_LEN;
const UY = AXIS_DY / AXIS_LEN;
// Ring seams along the axis (0..1), marking telescoping tube segments —
// explicit positions read as a collapsible spyglass; a plain modulo pattern
// (v1 of this file) just looked like a fluted rod.
const RING_POSITIONS = [0.32, 0.56, 0.78];
// The lens used to be a separate circle stamped at the tip — at this icon's
// resolution a small circle (radius ~2px) renders as a diamond, reading as
// a sparkle rather than glass and duplicating the wand's star motif. Tinting
// the last stretch of the *existing* tapered tube instead keeps the same rod
// silhouette with no new shape to misread.
const LENS_START_T = 0.88;

/** Spyglass tool icon — a flared brass eyepiece tapering to a glass-tipped tube. */
export function buildSpyglassIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline / rings
		b: 17, // bronze barrel highlight
		B: 12, // bronze barrel mid
		D: 2, // dark bronze — eyepiece rim shadow
		G: 30, // pale ghost blue — lens glass, flat (no bright-white glint: that
		// blooms into a starburst under soften() and duplicates the wand's tip)
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 4, 26);
	placeFlowerFleck(rows, 9, 23);
	return {
		name: "ui_icon_spyglass",
		width: WIDTH,
		height: HEIGHT,
		legend,
		rows,
	};
}

function radiusAt(t: number): number {
	// Flares wide at the eyepiece (t=0) then quickly narrows, unlike a smooth
	// linear taper — that flare read is what makes it a spyglass and not a rod.
	if (t < 0.15) return 4.4 - (4.4 - 2.1) * (t / 0.15);
	return 2.1 - (2.1 - 1.0) * ((t - 0.15) / 0.85);
}

function pixelAt(x: number, y: number): string {
	const rx = x - AX;
	const ry = y - AY;
	const along = rx * UX + ry * UY;
	const perp = rx * -UY + ry * UX;

	if (along < -1 || along > AXIS_LEN + 0.5) return ".";
	const t = Math.max(0, Math.min(1, along / AXIS_LEN));
	const radius = radiusAt(t);
	if (Math.abs(perp) > radius) return ".";
	if (t > LENS_START_T) return Math.abs(perp) > radius - 0.9 ? "O" : "G";
	if (Math.abs(perp) > radius - 0.9) return "O";
	if (t < 0.1) return "D"; // eyepiece rim, in shadow
	if (RING_POSITIONS.some((rp) => Math.abs(t - rp) < 0.03)) return "O";
	return perp < 0 ? "b" : "B";
}
