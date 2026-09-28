import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

export type SealColor = "red" | "plum";

export const WAX_SEAL_SIZE = 20;

/**
 * A round wax-seal button. `pressed` shrinks the radius and pulls the gloss
 * highlight up toward the rim rather than drawing a whole second sprite for
 * "pushed in" — hover has no dedicated art at all, it's a CSS
 * brightness+scale bump over this same normal sprite (see mockup.html).
 */
export function buildWaxSeal(color: SealColor, pressed: boolean): PixelMap {
	const size = WAX_SEAL_SIZE;
	const cx = (size - 1) / 2;
	const cy = (size - 1) / 2;
	const radius = pressed ? 8.3 : 9;
	const base = color === "red" ? UI_COLOR.sealRed : UI_COLOR.sealPlum;
	const highlight =
		color === "red" ? UI_COLOR.cream : UI_COLOR.sealPlumHighlight;
	const legend: Record<string, number> = {
		R: UI_COLOR.ink,
		B: base,
		H: highlight,
	};

	const rows: string[] = [];
	for (let y = 0; y < size; y++) {
		let row = "";
		for (let x = 0; x < size; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const dist = Math.hypot(dx, dy);
			if (dist > radius) {
				row += ".";
				continue;
			}
			if (dist > radius - 1.2) {
				row += "R"; // rim shadow
				continue;
			}
			// Gloss highlight sits high-and-left, as if lit from the same
			// direction as the wood frame's grain highlight — pressed pulls it
			// smaller and closer to the rim, reading as "flattened."
			const hOffsetY = pressed ? -3 : -2.2;
			const hdist = Math.hypot(dx + 1, dy - hOffsetY);
			row += hdist < radius * (pressed ? 0.3 : 0.42) ? "H" : "B";
		}
		rows.push(row);
	}
	return {
		name: `ui_wax_seal_${color}${pressed ? "_pressed" : ""}`,
		width: size,
		height: size,
		legend,
		rows,
	};
}
