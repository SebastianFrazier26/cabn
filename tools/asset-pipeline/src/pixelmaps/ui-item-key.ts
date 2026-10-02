import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";
import { cylinderBand, LIGHT_DIR, sphereBand } from "./ui-icon-shading.js";

const WIDTH = 32;
const HEIGHT = 58;
const CX = 15;
const BOW_CY = 13;
const BOW_OUTER = 11.2;
const BOW_INNER = 5.5;
const COLLAR_TOP = 25;
const COLLAR_BOTTOM = 28;
const SHAFT_BOTTOM = 52;
const SHAFT_RADIUS = 2.4;
const BIT_LEFT = CX + 2;

/**
 * Opener tool icon — replaces the matted photographic key_256.webp
 * (assets/source/icons/key.png) that was the last non-v3 icon on the
 * hotbar. Same construction as the other five v3 icons: ink outline, the
 * shared 4-band cel shading from ui-icon-shading.ts (the ring bow shaded as
 * a torus, the shaft as a cylinder, both lit from the fixed up-left
 * LIGHT_DIR), bronze/gold tones borrowed from the wand's gem setting, and
 * the shared leaf-sprig + cream-flower motif. Keeps the original's beats —
 * round bow, long shaft, a two-tooth bit, greenery at the base.
 */
export function buildKeyIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline
		D: 5, // dark bronze — shadow band
		M: 12, // bronze — base
		L: 21, // gold — lit band
		H: 25, // bright gold — highlight band
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 6, 55, 2);
	placeFlowerFleck(rows, 22, 55, 2);
	return { name: "ui_icon_key", width: WIDTH, height: HEIGHT, legend, rows };
}

const BAND_CHARS = ["D", "M", "L", "H"] as const;

function pixelAt(x: number, y: number): string {
	return bowChar(x, y) ?? collarChar(x, y) ?? bitChar(x, y) ?? shaftChar(x, y);
}

/** The bow is a ring; each point is shaded by the normal of the ring's tube cross-section (outward on the outer half, inward on the inner half) so it reads as a rounded torus, not a flat washer. */
function bowChar(x: number, y: number): string | null {
	const dx = x + 0.5 - (CX + 0.5);
	const dy = y + 0.5 - BOW_CY;
	const dist = Math.hypot(dx, dy);
	if (dist > BOW_OUTER || dist < BOW_INNER) return null;
	if (dist > BOW_OUTER - 1.1 || dist < BOW_INNER + 1.1) return "O";
	const tubeCenter = (BOW_OUTER + BOW_INNER) / 2;
	const tubeRadius = (BOW_OUTER - BOW_INNER) / 2;
	const t = (dist - tubeCenter) / tubeRadius;
	const nx = (dx / dist) * t;
	const ny = (dy / dist) * t;
	const dot = nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + 0.12;
	return BAND_CHARS[sphereBand(dot)];
}

function collarChar(x: number, y: number): string | null {
	if (y < COLLAR_TOP - 1 || y > COLLAR_BOTTOM) return null;
	const dx = x - CX;
	const halfWidth = 4;
	if (Math.abs(dx) > halfWidth) return null;
	if (Math.abs(dx) === halfWidth || y === COLLAR_TOP - 1 || y === COLLAR_BOTTOM)
		return "O";
	return BAND_CHARS[cylinderBand(dx, halfWidth)];
}

/** Two teeth sticking out to the right of the shaft near its tip, flat faces lit on top. */
function bitChar(x: number, y: number): string | null {
	const teeth: [number, number, number][] = [
		[41, 45, 24],
		[48, 51, 22],
	];
	for (const [top, bottom, right] of teeth) {
		if (y < top || y > bottom || x < BIT_LEFT || x > right) continue;
		if (y === top || y === bottom || x === right) return "O";
		if (y === top + 1) return "H";
		if (y === bottom - 1) return "D";
		return "M";
	}
	return null;
}

function shaftChar(x: number, y: number): string {
	if (y <= COLLAR_BOTTOM || y > SHAFT_BOTTOM + 1) return ".";
	const dx = x - CX;
	if (Math.abs(dx) > SHAFT_RADIUS) return ".";
	if (y === SHAFT_BOTTOM + 1 || Math.abs(dx) > SHAFT_RADIUS - 0.9) return "O";
	return BAND_CHARS[cylinderBand(dx, SHAFT_RADIUS)];
}
