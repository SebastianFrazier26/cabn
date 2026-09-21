import {
	type CropBox,
	cornerAverage,
	detectContentBBox,
	squareUp,
} from "./content-bbox.js";
import { backgroundFloodFillMask } from "./flood-fill.js";
import type { RawImage } from "./image-io.js";
import {
	dominantDownscale,
	type Grid,
	gridCornerBackground,
} from "./nearest-dominant.js";

export interface BackgroundGridConfig {
	targetSize: number;
	contentThreshold: number;
	backgroundDistanceThreshold: number;
	paddingPx: number;
	cropBox?: CropBox;
}

export interface BackgroundGridResult {
	box: CropBox;
	rawGrid: Grid;
	backgroundMask: boolean[];
}

/**
 * Shared by recover-sprites (crisp palette-snapped output) and
 * matte-originals (alpha mask over the untouched original) — both need the
 * same "which grid cell is background" answer, just applied differently.
 */
export function computeBackgroundGrid(
	image: RawImage,
	config: BackgroundGridConfig,
): BackgroundGridResult {
	const background = cornerAverage(image);
	const box = config.cropBox
		? config.cropBox
		: squareUp(
				detectContentBBox(image, background, config.contentThreshold),
				image.width,
				image.height,
				config.paddingPx,
			);

	const rawGrid = dominantDownscale(image, box, config.targetSize);
	const localBackground = gridCornerBackground(rawGrid);
	const backgroundMask = backgroundFloodFillMask(
		rawGrid,
		localBackground,
		config.backgroundDistanceThreshold,
	);

	return { box, rawGrid, backgroundMask };
}
