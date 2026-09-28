import { signedNoise } from "../noise.js";
import type { PixelMap } from "../pixelmap.js";
import { UI_COLOR } from "./ui-palette.js";

export interface WoodFrameOptions {
	/** Square tile side length in source pixels. */
	size: number;
	/** Border ring thickness in source pixels — this is also the CSS `border-image-slice` value once the tile is rendered. */
	border: number;
}

export const WOOD_FRAME_OPTIONS: WoodFrameOptions = { size: 32, border: 8 };

/**
 * A tileable wood-plank ring: a 9-slice `border-image` source. The center is
 * left transparent (not filled) — panels place their own parchment fill
 * behind it rather than relying on `border-image` to tile plank texture
 * across the middle, since planks running perpendicular to two adjacent
 * edges meet awkwardly at a shared corner tile otherwise.
 */
export function buildWoodFrameTile(
	opts: WoodFrameOptions = WOOD_FRAME_OPTIONS,
): PixelMap {
	const { size, border } = opts;
	const legend: Record<string, number> = {
		O: UI_COLOR.ink,
		D: UI_COLOR.darkWood,
		M: UI_COLOR.midWood,
		L: UI_COLOR.lightWood,
		H: UI_COLOR.woodHighlight,
	};
	const rows: string[] = [];
	for (let y = 0; y < size; y++) {
		let row = "";
		for (let x = 0; x < size; x++) {
			const onBorder =
				x < border || x >= size - border || y < border || y >= size - border;
			row += onBorder ? woodChar(x, y, size) : ".";
		}
		rows.push(row);
	}
	return { name: "ui_wood_frame", width: size, height: size, legend, rows };
}

function woodChar(x: number, y: number, size: number): string {
	const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
	if (edgeDist === 0) return "O"; // outer silhouette outline

	// Plank seams run across whichever edge this pixel sits on — top/bottom
	// edges seam along x, left/right edges seam along y — so seams read as
	// perpendicular joints between adjacent planks rather than one long board.
	const onTopOrBottom =
		y < size / 2 ? y < edgeDist + 1 : y >= size - edgeDist - 1;
	const along = onTopOrBottom ? x : y;
	if (along % 8 === 0) return "D"; // plank joint shadow

	const grain = signedNoise(x, y, 20260928);
	if (grain > 0.55) return "H";
	if (grain < -0.55) return "D";
	return grain > 0 ? "L" : "M";
}
