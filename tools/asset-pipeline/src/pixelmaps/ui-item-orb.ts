import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";
import { LIGHT_DIR, sphereBand } from "./ui-icon-shading.js";

const WIDTH = 44;
const HEIGHT = 52;
const CX = 21.5;
const CY = 18.5;
const RADIUS = 17;
const STAND_TOP = 37;

/**
 * Crystal orb tool icon — a swirling violet/cyan glass sphere on a bronze
 * stand. v3: adds a directional light/shadow crescent (sphereBand) layered
 * under the existing spiral swirl, so the sphere reads as a lit 3D object
 * rather than a flat two-tone pinwheel.
 */
export function buildCrystalOrbIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink rim
		P: 32, // plum — swirl dark / shadow crescent
		A: 33, // amethyst — swirl light / highlight crescent
		G: 30, // pale ghost blue — core glow
		W: 29, // cream — specular glint
		b: 17, // bronze highlight — stand
		m: 12, // bronze mid — stand
		B: 2, // dark bronze — stand shadow
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 3, 44, 2);
	placeFlowerFleck(rows, 30, 46, 2);
	return { name: "ui_icon_orb", width: WIDTH, height: HEIGHT, legend, rows };
}

function pixelAt(x: number, y: number): string {
	if (y >= STAND_TOP) return standChar(x, y);
	const dx = x - CX;
	const dy = y - CY;
	const dist = Math.hypot(dx, dy);
	if (dist > RADIUS) return ".";
	if (dist > RADIUS - 1.6) return "O";

	// Specular glint sits up-and-left of center — the one fixed bright point
	// every icon in this set uses the same light direction for.
	if (Math.hypot(dx + 5, dy + 6) < 3.2) return "W";
	if (dist < 3.6) return "G";

	const nx = dx / dist;
	const ny = dy / dist;
	const band = sphereBand(nx * LIGHT_DIR.x + ny * LIGHT_DIR.y);
	if (band === 0) return "P"; // shadow crescent, regardless of swirl
	if (band === 3) return "A"; // highlight crescent, regardless of swirl

	const angle = Math.atan2(dy, dx);
	const swirl = Math.sin(dist * 0.55 + angle * 1.6);
	return swirl > 0.1 ? "A" : "P";
}

function standChar(x: number, y: number): string {
	const row = y - STAND_TOP;
	const halfWidth = 5 + row * 0.85;
	const left = Math.round(CX - halfWidth);
	const right = Math.round(CX + halfWidth);
	if (x < left || x > right) return ".";
	if (x === left || x === right || row === 0) return "O";
	if (x === left + 1) return "b"; // highlight edge, matches the sphere's light side
	return row < 4 ? "m" : "B";
}
