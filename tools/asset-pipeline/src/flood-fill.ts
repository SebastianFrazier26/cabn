import { colorDistance, type RGB } from "./color.js";
import type { Grid } from "./nearest-dominant.js";

/**
 * Flood-fills from the four grid corners. A cell joins the background region
 * if its *pre-quantize* dominant color is within `threshold` of the cell
 * that discovered it (the already-filled neighbor), not a single fixed
 * reference color — vignette backgrounds drift smoothly from corner to
 * center, so corner-to-opposite-edge distance can exceed any reference-based
 * threshold that also has to stay tight enough to stop at a real object
 * edge. Chaining the tolerance step-to-step follows the gradient while still
 * treating a big jump (background-to-subject) as a boundary. The seed
 * corner's own color anchors the very first step.
 */
export function backgroundFloodFillMask(
	grid: Grid,
	seedBackground: RGB,
	threshold: number,
): boolean[] {
	const { width, height, cells } = grid;

	const mask = new Array<boolean>(width * height).fill(false);
	const stack: number[] = [];

	const corners = [0, width - 1, (height - 1) * width, height * width - 1];
	for (const start of corners) {
		const cell = cells[start];
		if (
			!mask[start] &&
			cell !== undefined &&
			colorDistance(cell, seedBackground) <= threshold
		) {
			mask[start] = true;
			stack.push(start);
		}
	}

	while (stack.length > 0) {
		const idx = stack.pop();
		if (idx === undefined) continue;
		const current = cells[idx];
		if (!current) continue;
		const x = idx % width;
		const y = Math.floor(idx / width);
		const neighbors: number[] = [];
		if (x > 0) neighbors.push(idx - 1);
		if (x < width - 1) neighbors.push(idx + 1);
		if (y > 0) neighbors.push(idx - width);
		if (y < height - 1) neighbors.push(idx + width);

		for (const n of neighbors) {
			if (mask[n]) continue;
			const neighborColor = cells[n];
			if (
				neighborColor !== undefined &&
				colorDistance(neighborColor, current) <= threshold
			) {
				mask[n] = true;
				stack.push(n);
			}
		}
	}

	return mask;
}
