import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import gifenc from "gifenc";
import sharp from "sharp";
import type { RGB } from "./color.js";
import {
	concatHorizontal,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import { paletteJsonPath, placeholdersDir } from "./paths.js";
import { renderPixelMap } from "./pixelmap.js";
import { portalArchFrame } from "./pixelmaps/portal-arch.js";
import { soften } from "./soften.js";

const TOTAL_FRAMES = 6;
const UPSCALE_FACTOR = 8;
const GIF_FRAME_DELAY_MS = 150;
const STRIP_CELL_SIZE = 256; // matches the crisp @8x frame size, so both strips line up in preview.html

/** Builds one shared indexed palette across all frames, plus a dedicated transparent index — sizes stay tiny (a dozen or so colors), so no need for gifenc's quantizer. */
function buildGifPalette(frames: readonly RawImage[]): {
	palette: number[][];
	indices: Uint8Array[];
	transparentIndex: number;
} {
	const palette: number[][] = [];
	const colorIndex = new Map<string, number>();
	const ensureColor = (r: number, g: number, b: number): number => {
		const key = `${r},${g},${b}`;
		const existing = colorIndex.get(key);
		if (existing !== undefined) return existing;
		const index = palette.length;
		palette.push([r, g, b]);
		colorIndex.set(key, index);
		return index;
	};

	// Pure black never appears in this palette (the darkest tone is a brown),
	// so it's a safe dedicated slot for GIF's 1-bit transparency.
	const transparentIndex = ensureColor(0, 0, 0);

	const indices = frames.map((frame) => {
		const index = new Uint8Array(frame.width * frame.height);
		for (let p = 0; p < index.length; p++) {
			const o = p * 4;
			const alpha = frame.data[o + 3] ?? 0;
			index[p] =
				alpha === 0
					? transparentIndex
					: ensureColor(
							frame.data[o] ?? 0,
							frame.data[o + 1] ?? 0,
							frame.data[o + 2] ?? 0,
						);
		}
		return index;
	});

	return { palette, indices, transparentIndex };
}

async function writeGif(
	frames: readonly RawImage[],
	outPath: string,
): Promise<void> {
	const { palette, indices, transparentIndex } = buildGifPalette(frames);
	const gif = gifenc.GIFEncoder();
	frames.forEach((frame, i) => {
		gif.writeFrame(indices[i] ?? new Uint8Array(), frame.width, frame.height, {
			palette: i === 0 ? palette : undefined,
			transparent: true,
			transparentIndex,
			delay: GIF_FRAME_DELAY_MS,
			repeat: 0,
		});
	});
	gif.finish();
	await writeFile(outPath, gif.bytes());
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
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);

	const upscaledFrames: RawImage[] = [];
	const softStripFrames: RawImage[] = [];

	for (let i = 0; i < TOTAL_FRAMES; i++) {
		const map = portalArchFrame(i, TOTAL_FRAMES);
		const raw = renderPixelMap(map, palette);

		const upscaled = await upscaleNearest(raw, UPSCALE_FACTOR);
		upscaledFrames.push(upscaled);
		await writeRawRgbaPng(
			upscaled,
			path.join(placeholdersDir, `portal_arch_frame${i}@8x.png`),
		);

		const softened = soften(raw);
		await writeRawRgbaPng(
			softened,
			path.join(placeholdersDir, `portal_arch_frame${i}_soft.png`),
		);
		softStripFrames.push(await resizeTo(softened, STRIP_CELL_SIZE));
	}

	await writeRawRgbaPng(
		concatHorizontal(upscaledFrames),
		path.join(placeholdersDir, "portal_arch_strip.png"),
	);
	await writeRawRgbaPng(
		concatHorizontal(softStripFrames),
		path.join(placeholdersDir, "portal_arch_strip_soft.png"),
	);
	await writeGif(
		upscaledFrames,
		path.join(placeholdersDir, "portal_arch_anim.gif"),
	);

	console.log(
		`Wrote ${TOTAL_FRAMES} portal_arch animation frames, strips, and GIF to ${placeholdersDir}`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
