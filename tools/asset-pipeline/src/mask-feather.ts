import type { CropBox } from "./content-bbox.js";

/**
 * Nearest-neighbor-upscales a boolean content grid into a full-resolution
 * single-channel canvas (255 = content, 0 = background), placed at `box`.
 * Everything outside `box` is background — the grid was only ever computed
 * for that cropped region. Pure and sync so it's cheap to unit-test without
 * touching sharp.
 */
export function placeMaskInCanvas(
	backgroundMask: readonly boolean[],
	gridSize: number,
	box: CropBox,
	canvasSize: number,
): Uint8Array {
	const canvas = new Uint8Array(canvasSize * canvasSize);
	const x0 = Math.max(0, Math.round(box.x));
	const y0 = Math.max(0, Math.round(box.y));
	const x1 = Math.min(canvasSize, Math.round(box.x + box.width));
	const y1 = Math.min(canvasSize, Math.round(box.y + box.height));

	for (let y = y0; y < y1; y++) {
		const gy = Math.min(
			gridSize - 1,
			Math.floor(((y - box.y) / box.height) * gridSize),
		);
		for (let x = x0; x < x1; x++) {
			const gx = Math.min(
				gridSize - 1,
				Math.floor(((x - box.x) / box.width) * gridSize),
			);
			const isBackground = backgroundMask[gy * gridSize + gx] ?? true;
			canvas[y * canvasSize + x] = isBackground ? 0 : 255;
		}
	}

	return canvas;
}

// Three passes of box blur closely approximate a Gaussian (a standard
// approximation — see e.g. Kovesi 2010) while staying trivial to implement
// and fully deterministic, which a sharp-based blur wouldn't buy us for free.
export function featherMask(
	mask: Uint8Array,
	width: number,
	height: number,
	radiusPx: number,
): Uint8Array {
	let current = mask;
	for (let pass = 0; pass < 3; pass++) {
		current = boxBlurPass(current, width, height, radiusPx);
	}
	return current;
}

function boxBlurPass(
	src: Uint8Array,
	width: number,
	height: number,
	radius: number,
): Uint8Array {
	const r = Math.max(1, Math.round(radius));
	const horizontal = new Float32Array(width * height);
	for (let y = 0; y < height; y++) {
		const row = y * width;
		let sum = 0;
		for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, width - 1)] ?? 0;
		for (let x = 0; x < width; x++) {
			horizontal[row + x] = sum / (2 * r + 1);
			const add = src[row + clamp(x + r + 1, 0, width - 1)] ?? 0;
			const remove = src[row + clamp(x - r, 0, width - 1)] ?? 0;
			sum += add - remove;
		}
	}

	const out = new Uint8Array(width * height);
	for (let x = 0; x < width; x++) {
		let sum = 0;
		for (let y = -r; y <= r; y++)
			sum += horizontal[clamp(y, 0, height - 1) * width + x] ?? 0;
		for (let y = 0; y < height; y++) {
			out[y * width + x] = Math.round(sum / (2 * r + 1));
			const add = horizontal[clamp(y + r + 1, 0, height - 1) * width + x] ?? 0;
			const remove = horizontal[clamp(y - r, 0, height - 1) * width + x] ?? 0;
			sum += add - remove;
		}
	}
	return out;
}

function clamp(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}
