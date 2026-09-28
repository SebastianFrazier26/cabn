import type { PixelMap } from "../pixelmap.js";
import {
	FLOWER_LEGEND,
	LEAF_LEGEND,
	placeFlowerFleck,
	placeLeafSprig,
} from "./ui-icon-motifs.js";

const WIDTH = 16;
const HEIGHT = 30;
const ROD_X = 8;
const TIP_Y = 3;
const HANDLE_TOP = 20;

/** Wand tool icon — a slender rod with a wrapped grip and a glowing star tip. */
export function buildWandIcon(): PixelMap {
	const legend: Record<string, number> = {
		O: 0, // ink outline
		D: 2, // dark wood — grip wrap
		M: 5, // mid wood — rod
		L: 8, // light wood — rod highlight
		g: 21, // gold — star core
		A: 33, // amethyst — star tips
		...LEAF_LEGEND,
		...FLOWER_LEGEND,
	};
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) row += pixelAt(x, y);
		rows.push(row);
	}
	placeLeafSprig(rows, 3, 27);
	placeFlowerFleck(rows, 11, 26);
	return { name: "ui_icon_wand", width: WIDTH, height: HEIGHT, legend, rows };
}

function pixelAt(x: number, y: number): string {
	const star = starChar(x, y);
	if (star) return star;
	if (y < TIP_Y + 2) return "."; // reserve headroom for the star's top point

	const dx = x - ROD_X;
	const radius = y < HANDLE_TOP ? 1.2 : 1.6; // handle is slightly thicker
	if (Math.abs(dx) > radius) return ".";
	if (Math.abs(dx) > radius - 0.6) return "O";
	if (y >= HANDLE_TOP && Math.floor((y - HANDLE_TOP) / 2) % 2 === 0) return "D"; // grip wrap bands
	return dx < 0 ? "L" : "M";
}

function starChar(x: number, y: number): string | null {
	const dx = x - ROD_X;
	const dy = y - TIP_Y;
	const armLen = Math.abs(dx) + Math.abs(dy); // diamond/plus star, cheap manhattan star
	if (armLen > 4) return null;
	if (armLen > 3) return "A";
	if (armLen > 0) return "g";
	return "O"; // single dark center pixel keeps the core from reading as a flat blob
}
