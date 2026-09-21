import type { RGB, WeightedColor } from "./color.js";

type Channel = "r" | "g" | "b";

function channelRange(colors: readonly WeightedColor[]): {
	channel: Channel;
	range: number;
} {
	let minR = 255;
	let maxR = 0;
	let minG = 255;
	let maxG = 0;
	let minB = 255;
	let maxB = 0;
	for (const c of colors) {
		if (c.r < minR) minR = c.r;
		if (c.r > maxR) maxR = c.r;
		if (c.g < minG) minG = c.g;
		if (c.g > maxG) maxG = c.g;
		if (c.b < minB) minB = c.b;
		if (c.b > maxB) maxB = c.b;
	}
	const ranges: Record<Channel, number> = {
		r: maxR - minR,
		g: maxG - minG,
		b: maxB - minB,
	};
	const channel: Channel =
		ranges.r >= ranges.g && ranges.r >= ranges.b
			? "r"
			: ranges.g >= ranges.b
				? "g"
				: "b";
	return { channel, range: ranges[channel] };
}

// Splits a box at the point where cumulative pixel weight along its longest
// channel crosses the midpoint, so both halves represent roughly equal
// numbers of source pixels (not just equal color-space volume).
function splitBox(
	colors: readonly WeightedColor[],
	channel: Channel,
): [WeightedColor[], WeightedColor[]] {
	const sorted = [...colors].sort((a, b) => a[channel] - b[channel]);
	const total = sorted.reduce((sum, c) => sum + c.count, 0);
	let running = 0;
	let splitAt = sorted.length - 1;
	for (let i = 0; i < sorted.length; i++) {
		const c = sorted[i];
		if (!c) continue;
		running += c.count;
		if (running >= total / 2) {
			splitAt = i;
			break;
		}
	}
	// Clamp so neither half is empty even when weight is concentrated at one end.
	const cut = Math.min(Math.max(splitAt + 1, 1), sorted.length - 1);
	return [sorted.slice(0, cut), sorted.slice(cut)];
}

function weightedAverage(colors: readonly WeightedColor[]): RGB {
	let r = 0;
	let g = 0;
	let b = 0;
	let total = 0;
	for (const c of colors) {
		r += c.r * c.count;
		g += c.g * c.count;
		b += c.b * c.count;
		total += c.count;
	}
	if (total === 0) return { r: 0, g: 0, b: 0 };
	return {
		r: Math.round(r / total),
		g: Math.round(g / total),
		b: Math.round(b / total),
	};
}

/**
 * Median-cut color quantization over a weighted color histogram.
 * Recursively splits the box with the widest channel range along that
 * channel's weighted median until `maxColors` boxes exist (or no box can be
 * split further), then returns each box's weighted-average color.
 */
export function medianCut(
	pixels: readonly WeightedColor[],
	maxColors: number,
): RGB[] {
	if (pixels.length === 0) return [];
	const boxes: WeightedColor[][] = [[...pixels]];

	while (boxes.length < maxColors) {
		let widestIndex = -1;
		let widestRange = -1;
		let widestChannel: Channel = "r";
		for (let i = 0; i < boxes.length; i++) {
			const box = boxes[i];
			if (!box || box.length < 2) continue;
			const { channel, range } = channelRange(box);
			if (range > widestRange) {
				widestRange = range;
				widestIndex = i;
				widestChannel = channel;
			}
		}
		if (widestIndex === -1) break;

		const box = boxes[widestIndex];
		if (!box) break;
		const [a, b] = splitBox(box, widestChannel);
		boxes.splice(widestIndex, 1, a, b);
	}

	return boxes.map(weightedAverage);
}
