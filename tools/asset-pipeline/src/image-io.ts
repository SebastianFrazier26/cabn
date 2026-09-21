import sharp from "sharp";

export interface RawImage {
	data: Buffer;
	width: number;
	height: number;
}

// Force RGBA regardless of source encoding so every pixel is a 4-byte tuple.
export async function loadRawRgba(filePath: string): Promise<RawImage> {
	const { data, info } = await sharp(filePath)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

export async function writeRawRgbaPng(
	image: RawImage,
	outPath: string,
): Promise<void> {
	await sharp(image.data, {
		raw: { width: image.width, height: image.height, channels: 4 },
	})
		.png()
		.toFile(outPath);
}

// Nearest-neighbor upscale, used for human-reviewable @Nx copies of small
// recovered/generated sprites — any other kernel would re-blur the crisp
// pixel edges the pipeline exists to produce.
export async function upscaleNearest(
	image: RawImage,
	factor: number,
): Promise<RawImage> {
	const width = image.width * factor;
	const height = image.height * factor;
	const data = await sharp(image.data, {
		raw: { width: image.width, height: image.height, channels: 4 },
	})
		.resize(width, height, { kernel: "nearest" })
		.raw()
		.toBuffer();
	return { data, width, height };
}

// Lays same-height frames left to right — used for the portal animation
// strip. Pure/sync: no reason to round-trip through sharp for a plain
// row-copy composite.
export function concatHorizontal(images: readonly RawImage[]): RawImage {
	const height = images[0]?.height ?? 0;
	const width = images.reduce((sum, img) => sum + img.width, 0);
	const data = Buffer.alloc(width * height * 4);

	let xOffset = 0;
	for (const img of images) {
		if (img.height !== height)
			throw new Error("concatHorizontal: all frames must share a height");
		for (let y = 0; y < height; y++) {
			const srcStart = y * img.width * 4;
			const destStart = (y * width + xOffset) * 4;
			img.data.copy(data, destStart, srcStart, srcStart + img.width * 4);
		}
		xOffset += img.width;
	}

	return { data, width, height };
}
