import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

const WIDTH = 40;
const HEIGHT = 7;
const CENTER_Y = 3;
const CENTER_X = WIDTH / 2;

/** A thin ink rule with a small gold diamond flourish at its center, for separating sections inside a parchment panel. */
export function buildDividerFlourish(): PixelMap {
	const legend: Record<string, number> = { O: UI_COLOR.ink, G: UI_COLOR.gold };
	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) {
			const diamond = Math.abs(x - CENTER_X) + Math.abs(y - CENTER_Y);
			if (diamond <= 3) {
				row += diamond === 3 ? "O" : "G";
			} else if (y === CENTER_Y) {
				row += "O";
			} else {
				row += ".";
			}
		}
		rows.push(row);
	}
	return {
		name: "ui_divider_flourish",
		width: WIDTH,
		height: HEIGHT,
		legend,
		rows,
	};
}
