import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { nearestColorIndex, type RGB } from "./color.js";
import {
	type CropBox,
	cornerAverage,
	detectContentBBox,
	squareUp,
} from "./content-bbox.js";
import { backgroundFloodFillMask } from "./flood-fill.js";
import {
	loadRawRgba,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import {
	dominantDownscale,
	type Grid,
	gridCornerBackground,
} from "./nearest-dominant.js";
import {
	paletteJsonPath,
	recoverConfigPath,
	recoveredDir,
	sourceIconsDir,
} from "./paths.js";

interface RecoverConfig {
	targetSize: number;
	contentThreshold: number;
	backgroundDistanceThreshold: number;
	paddingPx: number;
	cropBox?: CropBox;
}

function gridToRawImage(
	grid: Grid,
	alpha: (index: number) => number,
): RawImage {
	const data = Buffer.alloc(grid.width * grid.height * 4);
	grid.cells.forEach((cell, i) => {
		const px = i * 4;
		data[px] = cell.r;
		data[px + 1] = cell.g;
		data[px + 2] = cell.b;
		data[px + 3] = alpha(i);
	});
	return { data, width: grid.width, height: grid.height };
}

function snapGrid(grid: Grid, palette: readonly RGB[]): Grid {
	const cells = grid.cells.map(
		(cell) => palette[nearestColorIndex(cell, palette)] ?? cell,
	);
	return { width: grid.width, height: grid.height, cells };
}

const UPSCALE_FACTOR = 8;

async function recoverOne(
	name: string,
	config: RecoverConfig,
	palette: readonly RGB[],
): Promise<{ name: string; backgroundCells: number; totalCells: number }> {
	const image = await loadRawRgba(path.join(sourceIconsDir, `${name}.png`));
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
	const quantizedGrid = snapGrid(rawGrid, palette);
	const localBackground = gridCornerBackground(rawGrid);
	const backgroundMask = backgroundFloodFillMask(
		rawGrid,
		localBackground,
		config.backgroundDistanceThreshold,
	);
	const backgroundCells = backgroundMask.filter(Boolean).length;

	const quantizedOnly = gridToRawImage(quantizedGrid, () => 255);
	const recovered = gridToRawImage(quantizedGrid, (i) =>
		backgroundMask[i] ? 0 : 255,
	);

	await mkdir(recoveredDir, { recursive: true });
	const base = `${name}_${config.targetSize}`;

	await writeRawRgbaPng(recovered, path.join(recoveredDir, `${base}.png`));
	await writeRawRgbaPng(
		await upscaleNearest(recovered, UPSCALE_FACTOR),
		path.join(recoveredDir, `${base}@8x.png`),
	);

	// Kept alongside the background-removed result so preview.html can show
	// "quantized-only" vs "recovered" side by side without recomputing anything.
	await writeRawRgbaPng(
		quantizedOnly,
		path.join(recoveredDir, `${base}_quantized-only.png`),
	);
	await writeRawRgbaPng(
		await upscaleNearest(quantizedOnly, UPSCALE_FACTOR),
		path.join(recoveredDir, `${base}_quantized-only@8x.png`),
	);

	return { name, backgroundCells, totalCells: rawGrid.cells.length };
}

async function main() {
	const [configRaw, paletteRaw] = await Promise.all([
		readFile(recoverConfigPath, "utf8"),
		readFile(paletteJsonPath, "utf8"),
	]);
	const config: Record<string, RecoverConfig> = JSON.parse(configRaw);
	const palette: RGB[] = JSON.parse(paletteRaw).colors.map(
		(c: { rgb: RGB }) => c.rgb,
	);

	for (const [name, entry] of Object.entries(config)) {
		const result = await recoverOne(name, entry, palette);
		console.log(
			`${result.name}: ${result.totalCells - result.backgroundCells}/${result.totalCells} content cells (target ${entry.targetSize}x${entry.targetSize})`,
		);
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
