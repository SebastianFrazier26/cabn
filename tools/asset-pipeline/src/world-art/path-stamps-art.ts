import { createGrid, fillEllipse, type Grid } from "../pixel-shapes.js";

/**
 * Soft dirt-brush stamps, laid repeatedly along a path segment at runtime
 * (see packages/engine/src/render/pathStamps.ts) rather than authored as
 * corner/T/cross tiles on a grid — see gen-world-art.ts's doc comment on why
 * stamps won this batch. Three round sizes for width variation plus one
 * elongated stamp so a long straight stretch doesn't look like a row of
 * identical circles.
 */
export function buildPathStampGrids(
	dirt: number,
	dirtShadow: number,
	dirtHighlight: number,
): Grid[] {
	const small = createGrid(12, 12);
	fillEllipse(small, 6, 6, 5, 3.6, dirtShadow);
	fillEllipse(small, 6, 5.6, 4.2, 2.9, dirt);

	const medium = createGrid(16, 16);
	fillEllipse(medium, 8, 8, 7, 5, dirtShadow);
	fillEllipse(medium, 8, 7.5, 6, 4.1, dirt);
	fillEllipse(medium, 7, 6.5, 2, 1.3, dirtHighlight);

	const large = createGrid(20, 18);
	fillEllipse(large, 10, 9, 9, 6.4, dirtShadow);
	fillEllipse(large, 10, 8.5, 7.8, 5.3, dirt);
	fillEllipse(large, 8.5, 7, 2.6, 1.6, dirtHighlight);

	const elongated = createGrid(24, 12);
	fillEllipse(elongated, 12, 6, 11, 4.4, dirtShadow);
	fillEllipse(elongated, 12, 5.7, 9.8, 3.5, dirt);

	return [small, medium, large, elongated];
}
