import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RGB } from "./color.js";
import {
	concatHorizontal,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import { manifestJsonPath, paletteJsonPath, placeholdersDir } from "./paths.js";
import { renderPixelMap } from "./pixelmap.js";
import { bonfireFrame } from "./pixelmaps/bonfire.js";
import { soften } from "./soften.js";

const TOTAL_FRAMES = 4;
const UPSCALE_FACTOR = 8;
const STRIP_CELL_SIZE = 256; // matches the crisp @8x frame size, so the strip images line up cell-for-cell

interface ManifestEntry {
	locked: boolean;
}
type Manifest = Record<string, ManifestEntry>;

async function loadManifest(): Promise<Manifest> {
	try {
		return JSON.parse(await readFile(manifestJsonPath, "utf8"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}
}

async function resizeTo(image: RawImage, size: number): Promise<RawImage> {
	const data = await sharp(image.data, {
		raw: { width: image.width, height: image.height, channels: 4 },
	})
		.resize(size, size)
		.raw()
		.toBuffer();
	return { data, width: size, height: size };
}

async function main() {
	const manifest = await loadManifest();
	if (manifest.bonfire?.locked) {
		console.log("bonfire: skipped (locked)");
		return;
	}
	manifest.bonfire = { locked: manifest.bonfire?.locked ?? false };

	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);

	const upscaledFrames: RawImage[] = [];
	const softStripFrames: RawImage[] = [];

	for (let i = 0; i < TOTAL_FRAMES; i++) {
		const map = bonfireFrame(i, TOTAL_FRAMES);
		const raw = renderPixelMap(map, palette);
		await writeRawRgbaPng(
			raw,
			path.join(placeholdersDir, `bonfire_frame${i}.png`),
		);

		const upscaled = await upscaleNearest(raw, UPSCALE_FACTOR);
		upscaledFrames.push(upscaled);
		await writeRawRgbaPng(
			upscaled,
			path.join(placeholdersDir, `bonfire_frame${i}@8x.png`),
		);

		const softened = soften(raw);
		await writeRawRgbaPng(
			softened,
			path.join(placeholdersDir, `bonfire_frame${i}_soft.png`),
		);
		softStripFrames.push(await resizeTo(softened, STRIP_CELL_SIZE));
	}

	await writeRawRgbaPng(
		concatHorizontal(upscaledFrames),
		path.join(placeholdersDir, "bonfire_strip.png"),
	);
	await writeRawRgbaPng(
		concatHorizontal(softStripFrames),
		path.join(placeholdersDir, "bonfire_strip_soft.png"),
	);

	await writeFile(
		manifestJsonPath,
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);

	console.log(
		`Wrote ${TOTAL_FRAMES} bonfire animation frames and strips to ${placeholdersDir}`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
