import { signedNoise } from "../noise.js";
import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

export const HOTBAR_SLOT_SIZE = 28;
const BORDER = 5;

/**
 * A wood-framed socket the tool icon sits in. `selected` swaps the outer two
 * rings to gold rather than drawing a separate glow layer — cheap and reads
 * fine at hotbar size (48px on screen, per ToolHotbar.tsx).
 */
export function buildHotbarSlot(selected: boolean): PixelMap {
	const size = HOTBAR_SLOT_SIZE;
	const legend: Record<string, number> = {
		O: UI_COLOR.ink,
		D: UI_COLOR.darkWood,
		M: UI_COLOR.midWood,
		L: UI_COLOR.lightWood,
		H: UI_COLOR.woodHighlight,
		P: UI_COLOR.parchmentShade,
		G: UI_COLOR.gold,
	};

	const rows: string[] = [];
	for (let y = 0; y < size; y++) {
		let row = "";
		for (let x = 0; x < size; x++) {
			const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
			if (selected && edgeDist <= 1) {
				row += "G";
			} else if (edgeDist === 0) {
				row += "O";
			} else if (edgeDist < BORDER) {
				const grain = signedNoise(x, y, 90210 + edgeDist);
				row += grain > 0.4 ? "H" : grain < -0.4 ? "D" : "M";
			} else {
				row += "P"; // recessed socket the tool icon renders over
			}
		}
		rows.push(row);
	}
	return {
		name: `ui_hotbar_slot${selected ? "_selected" : ""}`,
		width: size,
		height: size,
		legend,
		rows,
	};
}
