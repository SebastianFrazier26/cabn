import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	colorDistance,
	luminance,
	type RGB,
	toHex,
	type WeightedColor,
} from "./color.js";
import { loadRawRgba, writeRawRgbaPng } from "./image-io.js";
import { medianCut } from "./median-cut.js";
import {
	generatedDir,
	paletteJsonPath,
	paletteSwatchPath,
	sourceIconNames,
	sourceIconsDir,
} from "./paths.js";

const MAX_COLORS = 32;
const ALPHA_IGNORE_THRESHOLD = 16;
const DEDUPE_DISTANCE = 12;
// Bucketing to the nearest multiple of 4 per channel before counting keeps the
// histogram in the tens of thousands of entries instead of millions — the
// source art is soft-shaded with near-continuous gradients, so an unbucketed
// histogram would be dominated by one-pixel-count noise that median-cut
// doesn't need to see anyway.
const HISTOGRAM_BUCKET = 4;

// Hand-picked, not extracted: the 5 source icons are entirely warm
// brown/green/cream, with no cool neutrals — the ghost placeholder (and
// anything else wanting moonlit/spectral tones) needs colors the median-cut
// histogram structurally can't produce. Appended after the sort so existing
// indices 0..N-1 stay stable across regenerations.
const CURATED_COLORS: { name: string; rgb: RGB }[] = [
	{ name: "steel gray", rgb: { r: 138, g: 145, b: 152 } },
	{ name: "bone / moonlight white", rgb: { r: 237, g: 238, b: 228 } },
	{ name: "pale ghost blue", rgb: { r: 191, g: 214, b: 224 } },
	{ name: "cool shadow blue-gray", rgb: { r: 92, g: 106, b: 122 } },
];

function bucket(value: number): number {
	return Math.round(value / HISTOGRAM_BUCKET) * HISTOGRAM_BUCKET;
}

async function buildHistogram(): Promise<{
	histogram: WeightedColor[];
	sources: string[];
}> {
	const counts = new Map<string, WeightedColor>();
	const sources: string[] = [];

	for (const name of sourceIconNames) {
		const file = `${name}.png`;
		sources.push(file);
		const { data } = await loadRawRgba(path.join(sourceIconsDir, file));
		for (let i = 0; i < data.length; i += 4) {
			const a = data[i + 3] ?? 0;
			if (a < ALPHA_IGNORE_THRESHOLD) continue;
			const r = bucket(data[i] ?? 0);
			const g = bucket(data[i + 1] ?? 0);
			const b = bucket(data[i + 2] ?? 0);
			const key = `${r},${g},${b}`;
			const existing = counts.get(key);
			if (existing) {
				existing.count++;
			} else {
				counts.set(key, { r, g, b, count: 1 });
			}
		}
	}

	return { histogram: [...counts.values()], sources };
}

// Median-cut boxes can end up with near-identical average colors when the
// source data clusters tightly; merge anything within DEDUPE_DISTANCE,
// keeping the color backed by more source pixels.
function dedupe(colors: RGB[], weights: number[]): RGB[] {
	const kept: { color: RGB; weight: number }[] = [];
	for (let i = 0; i < colors.length; i++) {
		const color = colors[i];
		const weight = weights[i] ?? 0;
		if (!color) continue;
		const dupIndex = kept.findIndex(
			(k) => colorDistance(k.color, color) < DEDUPE_DISTANCE,
		);
		if (dupIndex === -1) {
			kept.push({ color, weight });
		} else {
			const dup = kept[dupIndex];
			if (dup && weight > dup.weight) {
				kept[dupIndex] = { color, weight };
			}
		}
	}
	return kept.map((k) => k.color);
}

function boxWeight(histogram: WeightedColor[], color: RGB): number {
	// Approximate: sum counts of histogram entries this box's average is
	// nearest to. Cheap proxy for "how much source data backs this color".
	let weight = 0;
	for (const h of histogram) {
		if (colorDistance(h, color) < HISTOGRAM_BUCKET * 3) weight += h.count;
	}
	return weight;
}

async function main() {
	const { histogram, sources } = await buildHistogram();
	const rawColors = medianCut(histogram, MAX_COLORS);
	const weights = rawColors.map((c) => boxWeight(histogram, c));
	const deduped = dedupe(rawColors, weights);
	deduped.sort((a, b) => luminance(a) - luminance(b));

	await mkdir(generatedDir, { recursive: true });

	const allColors = [
		...deduped.map((rgb) => ({ hex: toHex(rgb), rgb, curated: false })),
		...CURATED_COLORS.map(({ rgb }) => ({
			hex: toHex(rgb),
			rgb,
			curated: true,
		})),
	];

	const palette = {
		colors: allColors,
		generatedAt: new Date().toISOString(),
		sources,
	};
	await writeFile(paletteJsonPath, `${JSON.stringify(palette, null, "\t")}\n`);

	const swatchSize = 32;
	const width = allColors.length * swatchSize;
	const height = swatchSize;
	const data = Buffer.alloc(width * height * 4);
	allColors.forEach(({ rgb: color }, index) => {
		for (let y = 0; y < swatchSize; y++) {
			for (let x = 0; x < swatchSize; x++) {
				const px = (y * width + index * swatchSize + x) * 4;
				data[px] = color.r;
				data[px + 1] = color.g;
				data[px + 2] = color.b;
				data[px + 3] = 255;
			}
		}
	});
	await writeRawRgbaPng({ data, width, height }, paletteSwatchPath);

	console.log(
		`Extracted ${deduped.length} colors from ${sources.length} sources, plus ${CURATED_COLORS.length} curated.`,
	);
	console.log(`Wrote ${paletteJsonPath}`);
	console.log(`Wrote ${paletteSwatchPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
