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

/** Alpha-over blit of `src` onto `dest` at (x, y), clipped to dest's bounds — used to build the preview page's composed mock-scene PNG without needing a browser/Phaser in the loop. */
export function compositeInto(
	dest: RawImage,
	src: RawImage,
	x: number,
	y: number,
): void {
	for (let sy = 0; sy < src.height; sy++) {
		const dy = y + sy;
		if (dy < 0 || dy >= dest.height) continue;
		for (let sx = 0; sx < src.width; sx++) {
			const dx = x + sx;
			if (dx < 0 || dx >= dest.width) continue;
			const sp = (sy * src.width + sx) * 4;
			const srcA = (src.data[sp + 3] ?? 0) / 255;
			if (srcA <= 0) continue;
			const dp = (dy * dest.width + dx) * 4;
			const destA = (dest.data[dp + 3] ?? 0) / 255;
			const outA = srcA + destA * (1 - srcA);
			for (let c = 0; c < 3; c++) {
				const srcC = src.data[sp + c] ?? 0;
				const destC = dest.data[dp + c] ?? 0;
				dest.data[dp + c] =
					outA > 0
						? Math.round((srcC * srcA + destC * destA * (1 - srcA)) / outA)
						: 0;
			}
			dest.data[dp + 3] = Math.round(outA * 255);
		}
	}
}

/**
 * Lays uniform-size frames into a `cols`-wide grid, row-major (Phaser's own
 * spritesheet frame numbering) — used for the biome tile/decal/path-stamp
 * sheets, where a single JSON index needs frame N to be at a fixed (row, col).
 * Frames must all share one size (batch 1's generators render every frame at
 * its sheet's fixed tile/decal size, so this is a caller invariant, not a
 * runtime feature).
 */
export function composeSheet(
	frames: readonly RawImage[],
	cols: number,
): RawImage {
	const first = frames[0];
	if (!first) return { data: Buffer.alloc(0), width: 0, height: 0 };
	const { width: frameW, height: frameH } = first;
	const rows = Math.ceil(frames.length / cols);
	const width = frameW * cols;
	const height = frameH * rows;
	const data = Buffer.alloc(width * height * 4);

	frames.forEach((frame, i) => {
		if (frame.width !== frameW || frame.height !== frameH) {
			throw new Error("composeSheet: every frame must share one size");
		}
		const col = i % cols;
		const row = Math.floor(i / cols);
		const destX = col * frameW;
		const destY = row * frameH;
		for (let y = 0; y < frameH; y++) {
			const srcStart = y * frameW * 4;
			const destStart = ((destY + y) * width + destX) * 4;
			frame.data.copy(data, destStart, srcStart, srcStart + frameW * 4);
		}
	});

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
