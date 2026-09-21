import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import { type RawImage, upscaleNearest, writeRawRgbaPng } from "./image-io.js";
import { hashNoise } from "./noise.js";
import { generatedDir, paletteJsonPath } from "./paths.js";
import { renderPixelMap } from "./pixelmap.js";
import { PORTAL_INTERIOR, portalArch } from "./pixelmaps/portal-arch.js";
import { soften } from "./soften.js";

const UPSCALE_FACTOR = 8;
const PARCHMENT: RGB = { r: 239, g: 224, b: 179 }; // palette index 27, palest cream
const GLOW: RGB = { r: 191, g: 214, b: 224 }; // palette index 30, pale ghost blue
const LINE_COLORS: RGB[] = [
	{ r: 111, g: 134, b: 58 }, // green — comment-ish
	{ r: 220, g: 139, b: 52 }, // gold — keyword-ish
	{ r: 92, g: 106, b: 122 }, // cool shadow — punctuation-ish
	{ r: 183, g: 109, b: 50 }, // orange — string-ish
];
const LINE_COUNT = 8;
const LINE_MARGIN = 2;
const LINE_SPACING = 2;
const SEED = 20260921;

function setPixel(
	image: RawImage,
	x: number,
	y: number,
	color: RGB,
	alpha = 255,
): void {
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
	const i = (y * image.width + x) * 4;
	image.data[i] = color.r;
	image.data[i + 1] = color.g;
	image.data[i + 2] = color.b;
	image.data[i + 3] = alpha;
}

/** Deterministic mock "code preview": each line gets a pseudo-random length and a syntax-ish color, seeded so reruns are reproducible. */
function paintFileParchment(image: RawImage): void {
	const { x, y, width, height } = PORTAL_INTERIOR;

	for (let py = y; py < y + height; py++) {
		for (let px = x; px < x + width; px++) setPixel(image, px, py, PARCHMENT);
	}

	// Glowing border where the parchment meets the arch — this is what
	// soften()'s bloom pass picks up to create the "glowing edges" effect.
	for (let px = x - 1; px <= x + width; px++) {
		setPixel(image, px, y - 1, GLOW);
		setPixel(image, px, y + height, GLOW);
	}
	for (let py = y - 1; py <= y + height; py++) {
		setPixel(image, x - 1, py, GLOW);
		setPixel(image, x + width, py, GLOW);
	}

	const maxLineWidth = width - LINE_MARGIN * 2;
	for (let line = 0; line < LINE_COUNT; line++) {
		const lineY = y + LINE_MARGIN + line * LINE_SPACING;
		if (lineY >= y + height - 1) break;
		const lengthNoise = hashNoise(line, 0, SEED);
		const length = Math.max(
			2,
			Math.round(maxLineWidth * (0.25 + lengthNoise * 0.7)),
		);
		const colorIndex = Math.floor(
			hashNoise(line, 1, SEED) * LINE_COLORS.length,
		);
		const color = LINE_COLORS[colorIndex] ?? LINE_COLORS[0];
		if (!color) continue;
		// Indent some lines for a code-like ragged left edge.
		const indent = hashNoise(line, 2, SEED) < 0.3 ? 1 : 0;
		for (
			let i = 0;
			i < length && LINE_MARGIN + indent + i < width - LINE_MARGIN;
			i++
		) {
			setPixel(image, x + LINE_MARGIN + indent + i, lineY, color);
		}
	}
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	const image = renderPixelMap(portalArch, palette);
	paintFileParchment(image);

	const upscaled = await upscaleNearest(image, UPSCALE_FACTOR);
	const outPath = path.join(generatedDir, "portal-preview-composite.png");
	await writeRawRgbaPng(upscaled, outPath);

	const softened = soften(image);
	const softOutPath = path.join(
		generatedDir,
		"portal-preview-composite_soft.png",
	);
	await writeRawRgbaPng(softened, softOutPath);

	console.log(`Wrote ${outPath}`);
	console.log(`Wrote ${softOutPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
