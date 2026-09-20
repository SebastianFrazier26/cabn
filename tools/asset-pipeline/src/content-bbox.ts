import { colorDistance, type RGB } from "./color.js";
import type { RawImage } from "./image-io.js";

export interface CropBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

function sampleBlockAverage(
	data: Buffer,
	imageWidth: number,
	x0: number,
	y0: number,
	size: number,
): RGB {
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let y = y0; y < y0 + size; y++) {
		for (let x = x0; x < x0 + size; x++) {
			const i = (y * imageWidth + x) * 4;
			r += data[i] ?? 0;
			g += data[i + 1] ?? 0;
			b += data[i + 2] ?? 0;
			n++;
		}
	}
	return { r: r / n, g: g / n, b: b / n };
}

export function cornerAverage(image: RawImage, sampleSize = 24): RGB {
	const { data, width, height } = image;
	const corners = [
		sampleBlockAverage(data, width, 0, 0, sampleSize),
		sampleBlockAverage(data, width, width - sampleSize, 0, sampleSize),
		sampleBlockAverage(data, width, 0, height - sampleSize, sampleSize),
		sampleBlockAverage(
			data,
			width,
			width - sampleSize,
			height - sampleSize,
			sampleSize,
		),
	];
	return averageRGB(corners);
}

export function averageRGB(colors: readonly RGB[]): RGB {
	const sum = colors.reduce(
		(acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
		{ r: 0, g: 0, b: 0 },
	);
	return {
		r: sum.r / colors.length,
		g: sum.g / colors.length,
		b: sum.b / colors.length,
	};
}

/**
 * Estimates the subject's bounding box: the vignette background is assumed
 * low-saturation and close to the average of the four image corners, so any
 * pixel far enough from that reference (by plain RGB distance) is content.
 */
export function detectContentBBox(
	image: RawImage,
	background: RGB,
	threshold: number,
): CropBox {
	const { data, width, height } = image;
	let minX = width;
	let maxX = -1;
	let minY = height;
	let maxY = -1;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const rgb: RGB = {
				r: data[i] ?? 0,
				g: data[i + 1] ?? 0,
				b: data[i + 2] ?? 0,
			};
			if (colorDistance(rgb, background) > threshold) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}

	if (maxX < minX || maxY < minY) {
		return { x: 0, y: 0, width, height };
	}
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Target grids are square; pad the shorter side symmetrically (clamped to
// image bounds) rather than stretching, so proportions survive the downscale.
export function squareUp(
	box: CropBox,
	imageWidth: number,
	imageHeight: number,
	paddingPx: number,
): CropBox {
	const side = Math.max(box.width, box.height) + paddingPx * 2;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	let x = Math.round(cx - side / 2);
	let y = Math.round(cy - side / 2);
	x = Math.max(0, Math.min(x, imageWidth - side));
	y = Math.max(0, Math.min(y, imageHeight - side));
	const clampedSide = Math.min(side, imageWidth, imageHeight);
	return {
		x: Math.max(0, x),
		y: Math.max(0, y),
		width: clampedSide,
		height: clampedSide,
	};
}
