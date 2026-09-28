import { hashNoise } from "../noise.js";
import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

const WIDTH = 24;
const BODY_HEIGHT = 13; // rows 0..12
const HEIGHT = 17; // body + tail

/** A small wood-trimmed parchment speech bubble with a downward pointer tail, for keybinding hints. */
export function buildTooltipBubble(): PixelMap {
	const legend: Record<string, number> = {
		O: UI_COLOR.ink,
		W: UI_COLOR.midWood,
		P: UI_COLOR.parchment,
		S: UI_COLOR.parchmentShade,
	};

	const rows: string[] = [];
	for (let y = 0; y < HEIGHT; y++) {
		let row = "";
		for (let x = 0; x < WIDTH; x++) {
			if (y < BODY_HEIGHT) {
				row += bodyChar(x, y);
			} else {
				row += tailChar(x, y - BODY_HEIGHT);
			}
		}
		rows.push(row);
	}
	return {
		name: "ui_tooltip_bubble",
		width: WIDTH,
		height: HEIGHT,
		legend,
		rows,
	};
}

function bodyChar(x: number, y: number): string {
	const chamfered =
		(x === 0 || x === WIDTH - 1) && (y === 0 || y === BODY_HEIGHT - 1);
	if (chamfered) return ".";
	const isOutline =
		x === 0 || x === WIDTH - 1 || y === 0 || y === BODY_HEIGHT - 1;
	if (isOutline) return "O";
	const isTrim = x === 1 || x === WIDTH - 2 || y === 1 || y === BODY_HEIGHT - 2;
	if (isTrim) return "W";
	return hashNoise(x, y, 5551234) < 0.06 ? "S" : "P";
}

function tailChar(x: number, tailY: number): string {
	const halfWidth = Math.max(0, 2 - tailY);
	const startX = 4 + tailY;
	const endX = startX + halfWidth * 2;
	if (x < startX || x >= endX) return ".";
	const isEdge = x === startX || x === endX - 1 || tailY === 2;
	return isEdge ? "O" : "P";
}
