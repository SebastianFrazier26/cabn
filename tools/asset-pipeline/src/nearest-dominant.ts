import type { RGB } from "./color.js";
import { averageRGB, type CropBox } from "./content-bbox.js";
import type { RawImage } from "./image-io.js";

export interface Grid {
	width: number;
	height: number;
	cells: RGB[];
}

// Vignettes are radial, so the true image-corner color can be far from the
// background tone right at the edge of a tight content crop. Averaging a
// block of the grid's own corner cells (post-crop) tracks that local tone
// instead, which is what the flood-fill background test needs.
export function gridCornerBackground(grid: Grid, blockSize = 4): RGB {
	const { width, height, cells } = grid;
	const size = Math.max(
		1,
		Math.min(blockSize, Math.floor(Math.min(width, height) / 2)),
	);

	const blockAverage = (x0: number, y0: number): RGB => {
		const block: RGB[] = [];
		for (let y = y0; y < y0 + size; y++) {
			for (let x = x0; x < x0 + size; x++) {
				const cell = cells[y * width + x];
				if (cell) block.push(cell);
			}
		}
		return averageRGB(block);
	};

	return averageRGB([
		blockAverage(0, 0),
		blockAverage(width - size, 0),
		blockAverage(0, height - size),
		blockAverage(width - size, height - size),
	]);
}

/**
 * Downscales a crop region to a `targetSize`x`targetSize` grid by taking the
 * modal (most frequent) color in each source cell, not the mean — averaging
 * across a chunky-pixel-art region blurs the hard edges between adjacent
 * "chunks", which is exactly what recovery is trying to preserve.
 */
export function dominantDownscale(
	image: RawImage,
	crop: CropBox,
	targetSize: number,
): Grid {
	const { data, width: imageWidth } = image;
	const cells: RGB[] = new Array(targetSize * targetSize);

	for (let cy = 0; cy < targetSize; cy++) {
		const y0 = crop.y + Math.floor((cy * crop.height) / targetSize);
		const y1 = crop.y + Math.floor(((cy + 1) * crop.height) / targetSize);
		for (let cx = 0; cx < targetSize; cx++) {
			const x0 = crop.x + Math.floor((cx * crop.width) / targetSize);
			const x1 = crop.x + Math.floor(((cx + 1) * crop.width) / targetSize);

			const counts = new Map<string, { rgb: RGB; count: number }>();
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) {
					const i = (y * imageWidth + x) * 4;
					const r = data[i] ?? 0;
					const g = data[i + 1] ?? 0;
					const b = data[i + 2] ?? 0;
					const key = `${r},${g},${b}`;
					const existing = counts.get(key);
					if (existing) existing.count++;
					else counts.set(key, { rgb: { r, g, b }, count: 1 });
				}
			}

			let best: { rgb: RGB; count: number } | undefined;
			for (const entry of counts.values()) {
				if (!best || entry.count > best.count) best = entry;
			}
			cells[cy * targetSize + cx] = best?.rgb ?? { r: 0, g: 0, b: 0 };
		}
	}

	return { width: targetSize, height: targetSize, cells };
}
