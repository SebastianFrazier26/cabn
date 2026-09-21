import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
	type BackgroundGridConfig,
	computeBackgroundGrid,
} from "./background-grid.js";
import { loadRawRgba, type RawImage } from "./image-io.js";
import { featherMask, placeMaskInCanvas } from "./mask-feather.js";
import {
	generatedDir,
	recoverConfigPath,
	sourceIconNames,
	sourceIconsDir,
} from "./paths.js";

const ORIGINALS_DIR = path.join(generatedDir, "originals");
const DOWNSCALE_SIZES = [512, 256];
const FEATHER_RADIUS_PX = 2;
const WEBP_QUALITY = 90;

// The user prefers the original soft-rendered 1024s over the crisp recovered
// sprites — this reuses the same background-classification grid (crop box +
// dominant-color grid + flood-fill mask) that recover-sprites.ts computes,
// but applies it as an alpha matte over the untouched original pixels
// instead of over palette-snapped ones.
async function matteOne(
	name: string,
	config: BackgroundGridConfig,
): Promise<RawImage> {
	const image = await loadRawRgba(path.join(sourceIconsDir, `${name}.png`));
	const { box, rawGrid, backgroundMask } = computeBackgroundGrid(image, config);

	const hardMask = placeMaskInCanvas(
		backgroundMask,
		rawGrid.width,
		box,
		image.width,
	);
	const softMask = featherMask(
		hardMask,
		image.width,
		image.height,
		FEATHER_RADIUS_PX,
	);

	const data = Buffer.from(image.data);
	for (let i = 0; i < softMask.length; i++) {
		data[i * 4 + 3] = softMask[i] ?? 0;
	}
	return { data, width: image.width, height: image.height };
}

async function writeVariants(
	name: string,
	matted: RawImage,
): Promise<string[]> {
	const lines: string[] = [];
	const full = path.join(ORIGINALS_DIR, `${name}.png`);
	await sharp(matted.data, {
		raw: { width: matted.width, height: matted.height, channels: 4 },
	})
		.png()
		.toFile(full);
	lines.push(await sizeLine(full));

	for (const size of DOWNSCALE_SIZES) {
		const pngPath = path.join(ORIGINALS_DIR, `${name}_${size}.png`);
		const webpPath = path.join(ORIGINALS_DIR, `${name}_${size}.webp`);
		const resized = sharp(matted.data, {
			raw: { width: matted.width, height: matted.height, channels: 4 },
		}).resize(size, size);

		await resized.clone().png().toFile(pngPath);
		await resized.clone().webp({ quality: WEBP_QUALITY }).toFile(webpPath);
		lines.push(await sizeLine(pngPath));
		lines.push(await sizeLine(webpPath));
	}
	return lines;
}

async function sizeLine(filePath: string): Promise<string> {
	const { size } = await stat(filePath);
	return `${path.basename(filePath)}: ${(size / 1024).toFixed(1)} KB`;
}

async function main() {
	const config: Record<string, BackgroundGridConfig> = JSON.parse(
		await readFile(recoverConfigPath, "utf8"),
	);
	await mkdir(ORIGINALS_DIR, { recursive: true });

	for (const name of sourceIconNames) {
		const entry = config[name];
		if (!entry) continue;
		const matted = await matteOne(name, entry);
		const lines = await writeVariants(name, matted);
		console.log(`${name}:`);
		for (const line of lines) console.log(`  ${line}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
