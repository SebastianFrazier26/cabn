import { hashNoise } from "../noise.js";
import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

export const PARCHMENT_TILE_SIZE = 32;

/**
 * Tileable parchment fiber texture. The smooth mottling comes from sine
 * fields with period === tile size, so it wraps with zero seam; the sparse
 * one-pixel flecks on top come from a plain hash and are NOT seam-safe (a
 * fleck at the right edge won't necessarily continue on the left edge of the
 * next tile) — at this density that reads as fine grain, not a visible seam,
 * but hasn't been checked at real panel sizes (see STYLE.md open questions).
 */
export function buildParchmentTile(
	size = PARCHMENT_TILE_SIZE,
	seed = 20260928,
): PixelMap {
	const legend: Record<string, number> = {
		P: UI_COLOR.parchment,
		S: UI_COLOR.parchmentShade,
		C: UI_COLOR.cream,
		G: UI_COLOR.gold,
	};
	const rows: string[] = [];
	for (let y = 0; y < size; y++) {
		let row = "";
		for (let x = 0; x < size; x++) {
			const wave =
				Math.sin((2 * Math.PI * x) / size) *
					Math.cos((2 * Math.PI * y) / size) +
				0.5 * Math.sin((4 * Math.PI * y) / size);
			let ch = wave > 0.4 ? "C" : wave < -0.5 ? "S" : "P";

			const fleck = hashNoise(x, y, seed);
			if (ch === "P" && fleck > 0.985)
				ch = "G"; // rare gold fiber
			else if (ch === "P" && fleck < 0.03) ch = "S"; // dark speck
			row += ch;
		}
		rows.push(row);
	}
	return { name: "ui_parchment_fill", width: size, height: size, legend, rows };
}
