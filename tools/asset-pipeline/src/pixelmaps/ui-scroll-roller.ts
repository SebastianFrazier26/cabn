import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

const WIDTH = 48;
const HEIGHT = 10;
const KNOB_RADIUS = 5;

export type RollerPosition = "top" | "bottom";

/**
 * A wooden dowel end-cap for the run-parchment scroll (see RunOverlay.tsx's
 * current CSS-gradient placeholder). `bottom` reverses the row order of
 * `top`'s render — light source stays fixed, but the bottom roller's visible
 * curve faces the opposite way, so its highlight band sits on the opposite edge.
 */
export function buildScrollRoller(position: RollerPosition): PixelMap {
	const legend: Record<string, number> = {
		O: UI_COLOR.ink,
		D: UI_COLOR.darkWood,
		M: UI_COLOR.midWood,
		L: UI_COLOR.lightWood,
		H: UI_COLOR.woodHighlight,
	};

	const built: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) {
			const leftKnob = Math.hypot(x - KNOB_RADIUS, y - HEIGHT / 2 + 0.5);
			const rightKnob = Math.hypot(
				x - (WIDTH - 1 - KNOB_RADIUS),
				y - HEIGHT / 2 + 0.5,
			);
			const inShaft = x >= KNOB_RADIUS && x < WIDTH - KNOB_RADIUS;
			const inKnob = leftKnob <= KNOB_RADIUS || rightKnob <= KNOB_RADIUS;
			if (!inShaft && !inKnob) {
				row += ".";
				continue;
			}
			const isEdge =
				y === 0 ||
				y === HEIGHT - 1 ||
				(!inShaft &&
					(leftKnob > KNOB_RADIUS - 0.8 || rightKnob > KNOB_RADIUS - 0.8));
			if (isEdge) {
				row += "O";
				continue;
			}
			row += y < 3 ? "H" : y < 6 ? "L" : y < 8 ? "M" : "D";
		}
		built.push(row);
	}
	const rows = position === "top" ? built : [...built].reverse();
	return {
		name: `ui_scroll_roller_${position}`,
		width: WIDTH,
		height: HEIGHT,
		legend,
		rows,
	};
}
