import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	colorDistance,
	luminance,
	type RGB,
	toHex,
	type WeightedColor,
} from "./color.js";
import { loadRawRgba, writeRawRgbaPng } from "./image-io.js";
import { writeJsonFile } from "./json-io.js";
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
	// Staff gem: no purple exists anywhere in the extracted set either.
	{ name: "deep plum", rgb: { r: 88, g: 51, b: 107 } },
	{ name: "bright amethyst", rgb: { r: 178, g: 124, b: 214 } },
	// M6 monster sprites: gremlin/ouroboros eyes want a hot red the warm
	// browns/oranges can't give (they're all too desaturated), and
	// will-o-wisp wants a pale blue-green the existing pale-ghost-blue reads
	// too purely blue for on its own.
	{ name: "ember red", rgb: { r: 200, g: 40, b: 30 } },
	{ name: "wisp pale green", rgb: { r: 190, g: 230, b: 205 } },
	// M10b batch 1 (world art), first pass: cottagecore flower/berry accents —
	// the extracted set is still all warm brown/green, nothing that reads as
	// a bloom or a berry against grass. Superseded by the saturated set
	// directly below after user feedback (see that comment) but left in
	// place rather than renumbered — anything already rendered against these
	// indices (none, as of that feedback) would otherwise silently shift.
	{ name: "blossom pink", rgb: { r: 227, g: 165, b: 186 } },
	{ name: "cornflower blue", rgb: { r: 121, g: 148, b: 210 } },
	{ name: "butter yellow", rgb: { r: 240, g: 208, b: 92 } },
	{ name: "berry red", rgb: { r: 176, g: 66, b: 66 } },
	// M10b batch 1, second pass: the first-pass tones above plus the
	// extracted warm-brown/green set both read as muted/antique — rejected
	// as bland. This set targets a saturated Stardew Valley / Pokémon
	// Black-White cheerful look instead: brighter grass greens, a sunny sand
	// path (not mud-brown), and bold berry/sky/sun accent colors. Palette is
	// a guide, not a cage — curated freely per the standing direction.
	{ name: "meadow shadow bright", rgb: { r: 70, g: 150, b: 60 } },
	{ name: "meadow base bright", rgb: { r: 120, g: 200, b: 90 } },
	{ name: "meadow highlight bright", rgb: { r: 180, g: 230, b: 120 } },
	{ name: "grove shadow bright", rgb: { r: 35, g: 110, b: 60 } },
	{ name: "grove base bright", rgb: { r: 60, g: 150, b: 80 } },
	{ name: "grove highlight bright", rgb: { r: 110, g: 190, b: 110 } },
	{ name: "glade shadow bright", rgb: { r: 60, g: 140, b: 120 } },
	{ name: "glade base bright", rgb: { r: 100, g: 190, b: 150 } },
	{ name: "glade highlight bright", rgb: { r: 170, g: 225, b: 180 } },
	{ name: "path shadow sand", rgb: { r: 196, g: 150, b: 88 } },
	{ name: "path base sand", rgb: { r: 230, g: 190, b: 120 } },
	{ name: "path highlight sand", rgb: { r: 245, g: 220, b: 165 } },
	{ name: "berry pink bright", rgb: { r: 235, g: 90, b: 150 } },
	{ name: "sky blue bright", rgb: { r: 90, g: 160, b: 235 } },
	{ name: "sun yellow bright", rgb: { r: 255, g: 220, b: 70 } },
	{ name: "mushroom red bright", rgb: { r: 230, g: 60, b: 50 } },
	{ name: "autumn orange bright", rgb: { r: 235, g: 140, b: 60 } },
	{ name: "autumn orange dark", rgb: { r: 180, g: 90, b: 40 } },
	{ name: "stone light bright", rgb: { r: 190, g: 195, b: 205 } },
	{ name: "stone mid bright", rgb: { r: 150, g: 158, b: 170 } },
	{ name: "stone dark bright", rgb: { r: 100, g: 108, b: 120 } },
	{ name: "wood warm bright", rgb: { r: 150, g: 100, b: 60 } },
	{ name: "wood dark bright", rgb: { r: 110, g: 70, b: 40 } },
	{ name: "wood light bright", rgb: { r: 190, g: 140, b: 90 } },
	{ name: "terracotta bright", rgb: { r: 210, g: 120, b: 70 } },
	{ name: "lantern glow bright", rgb: { r: 255, g: 240, b: 180 } },
	// Portal-type arches (2026-09-28): Python/TypeScript want a true mid and
	// deep blue (sky blue bright alone reads as "url"/sky), and Go its cyan —
	// none of the existing blues are dark or green-shifted enough.
	{ name: "sapphire", rgb: { r: 48, g: 98, b: 170 } },
	{ name: "deep navy", rgb: { r: 32, g: 52, b: 98 } },
	{ name: "gopher cyan", rgb: { r: 64, g: 174, b: 206 } },
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
		sources,
	};
	await writeJsonFile(paletteJsonPath, palette);

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
