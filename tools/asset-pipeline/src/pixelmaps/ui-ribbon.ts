import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

export type RibbonColor = "crimson" | "victory";

const WIDTH = 64;
const HEIGHT = 16;
const WING = 12; // px of tabbed end on each side

/**
 * A title ribbon: a solid center body flanked by two slit-ended tabs (each
 * tab is two separate horizontal bars with a gap between them, not a
 * diagonal swallowtail cut — simpler to generate correctly and still reads
 * as "ribbon" at hotbar-banner scale). Used behind EncounterBanner/victory
 * toast text.
 */
export function buildRibbonBanner(color: RibbonColor = "crimson"): PixelMap {
	const fill = color === "crimson" ? UI_COLOR.sealRed : UI_COLOR.victoryGreen;
	const legend: Record<string, number> = {
		O: UI_COLOR.ink,
		F: fill,
		G: UI_COLOR.gold,
	};

	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) {
			const inWing = x < WING || x >= WIDTH - WING;
			const band = inWing
				? bandFor(y, [
						[3, 7],
						[9, 13],
					])
				: bandFor(y, [[3, 13]]);
			if (!band) {
				row += ".";
				continue;
			}
			const [top, bottom] = band;
			const isOuterColumn = x === 0 || x === WIDTH - 1;
			const isEdgeRow = y === top || y === bottom - 1;
			const isTrimRow = y === top + 1 || y === bottom - 2;
			row += isOuterColumn || isEdgeRow ? "O" : isTrimRow ? "G" : "F";
		}
		rows.push(row);
	}
	return {
		name: `ui_ribbon_${color}`,
		width: WIDTH,
		height: HEIGHT,
		legend,
		rows,
	};
}

function bandFor(
	y: number,
	bands: Array<[number, number]>,
): [number, number] | null {
	for (const [top, bottom] of bands) {
		if (y >= top && y < bottom) return [top, bottom];
	}
	return null;
}
