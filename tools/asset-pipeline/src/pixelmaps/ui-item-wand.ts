import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";
import { cylinderBand } from "./ui-icon-shading.js";

const WIDTH = 34;
const HEIGHT = 60;
const ROD_X = 17;
const GEM_CY = 9;
const GEM_RADIUS = 8; // diamond half-diagonal
const SETTING_BOTTOM = 20;
const HANDLE_TOP = 40;

/**
 * Wand tool icon — a carved-grip rod topped with a faceted gem in a metal
 * setting. v3 replaces v2's plain wrapped-band handle and plus-shaped star
 * with a genuinely twisted grip (diagonal carve bands) and a 4-facet
 * diamond gem, per the "more character" ask — a plus-shaped sparkle read as
 * generic magic-glow, not as a wand's actual jewel.
 */
export function buildWandIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline
		D: 2, // dark wood — rod shadow / handle carve shadow
		M: 5, // mid wood — rod base
		L: 8, // light wood — rod highlight / handle carve highlight
		H: 13, // wood highlight — brightest carve facet
		s: 17, // bronze — gem setting highlight
		S: 12, // bronze — gem setting mid
		g: 21, // gold — gem facet, mid
		G: 25, // brighter gold — gem facet, highlight (top facet)
		A: 33, // amethyst — gem facet, mid-shadow
		P: 32, // plum — gem facet, deepest shadow
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 4, 55, 2);
	placeFlowerFleck(rows, 22, 52, 2);
	return { name: "ui_icon_wand", width: WIDTH, height: HEIGHT, legend, rows };
}

function pixelAt(x: number, y: number): string {
	const gem = gemChar(x, y);
	if (gem) return gem;
	if (y < GEM_CY + GEM_RADIUS + 2) return "."; // headroom above the setting, under the gem

	if (y <= SETTING_BOTTOM) return settingChar(x, y);
	return rodChar(x, y);
}

/** A diamond cut into four flat triangular facets — top brightest, bottom darkest. */
function gemChar(x: number, y: number): string | null {
	const dx = x - ROD_X;
	const dy = y - GEM_CY;
	const manhattan = Math.abs(dx) + Math.abs(dy);
	if (manhattan > GEM_RADIUS) return null;
	if (manhattan > GEM_RADIUS - 1.3) return "O";
	if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "G" : "P"; // top / bottom facet
	return dx < 0 ? "g" : "A"; // left / right facet
}

function settingChar(x: number, y: number): string {
	const dx = x - ROD_X;
	const row = y - (GEM_CY + GEM_RADIUS + 2);
	const halfWidth = 2.2 + row * 0.25;
	if (Math.abs(dx) > halfWidth) return ".";
	if (Math.abs(dx) > halfWidth - 0.8) return "O";
	return dx < 0 ? "s" : "S";
}

function rodChar(x: number, y: number): string {
	const dx = x - ROD_X;
	const radius = y < HANDLE_TOP ? 1.6 : 2.2; // handle is slightly thicker
	if (Math.abs(dx) > radius) return ".";
	if (Math.abs(dx) > radius - 0.7) return "O";

	if (y < HANDLE_TOP) {
		const band = cylinderBand(dx, radius);
		return band === 3 ? "H" : band === 2 ? "L" : band === 1 ? "M" : "D";
	}

	// Carved/twisted grip: diagonal bands (phase shifts with x) rather than
	// flat horizontal wraps — that diagonal is what reads as "twisted," a
	// horizontal-only band (v2) just looked like tape wrapped around a stick.
	const twist = Math.floor((y - HANDLE_TOP) / 2 + dx * 1.5) % 2 === 0;
	const base = cylinderBand(dx, radius);
	if (twist) return base >= 2 ? "H" : "L";
	return base >= 2 ? "M" : "D";
}
