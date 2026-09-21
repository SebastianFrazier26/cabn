import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { luminance, type RGB } from "./color.js";
import { loadRawRgba, type RawImage, writeRawRgbaPng } from "./image-io.js";
import { featherMask } from "./mask-feather.js";
import { signedNoise } from "./noise.js";
import { generatedDir, placeholdersDir, recoveredDir } from "./paths.js";

export interface SoftenOptions {
	/** Output pixels per source pixel. Original art renders each "chunk" at roughly this size. */
	cellSize: number;
	/** How strongly a cell shades toward brighter/darker neighbors (0 = flat, ~0.3 matches the source's chunky bevel look). */
	gradientStrength: number;
	/** Per-cell color jitter magnitude, in 0-255 units. */
	jitterStrength: number;
	/** Per-pixel monochromatic grain magnitude, in 0-255 units. */
	grainStrength: number;
	/** Luminance (0-255) above which a cell starts contributing bloom. */
	bloomThreshold: number;
	/** How much brightened bloom bleeds into neighboring/background pixels (0-1). */
	bloomStrength: number;
	/** Blur radius for the bloom bleed, in output pixels. */
	bloomRadiusPx: number;
	/** Blur radius for softening the hard cell-grid silhouette edge, in output pixels. */
	edgeFeatherPx: number;
	/** Seed for the deterministic per-cell/per-pixel noise — same seed + input always reproduces the same output. */
	seed: number;
}

// Tuned against the M2 calibration target: soften(recovered cabin_64) sat
// next to the original cabin.png in preview.html until the chunky-but-soft
// bevel look matched (see CHANGELOG for the calibration verdict).
export const DEFAULT_SOFTEN_OPTIONS: SoftenOptions = {
	cellSize: 16,
	gradientStrength: 0.22,
	jitterStrength: 5,
	grainStrength: 3,
	bloomThreshold: 180,
	bloomStrength: 0.45,
	bloomRadiusPx: 8,
	edgeFeatherPx: 2,
	seed: 20260920,
};

function clamp255(v: number): number {
	return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

interface Cell {
	rgb: RGB;
	alpha: number;
	luminance: number;
}

function readCells(source: RawImage): Cell[] {
	const cells: Cell[] = new Array(source.width * source.height);
	for (let i = 0; i < cells.length; i++) {
		const p = i * 4;
		const rgb = {
			r: source.data[p] ?? 0,
			g: source.data[p + 1] ?? 0,
			b: source.data[p + 2] ?? 0,
		};
		const alpha = source.data[p + 3] ?? 0;
		cells[i] = { rgb, alpha, luminance: alpha > 0 ? luminance(rgb) : 0 };
	}
	return cells;
}

/**
 * Converts a crisp small pixel-grid render into the source art's soft-shaded
 * look: each source pixel becomes a `cellSize` block with a directional
 * gradient (toward whichever neighbor is brighter), a fixed per-cell color
 * jitter, per-pixel grain, a soft bloom bleed around bright cells, and a
 * feathered silhouette edge. Every randomized-looking element is actually a
 * deterministic hash of position + seed, so the same input always produces
 * byte-identical output.
 */
export function soften(
	source: RawImage,
	options: Partial<SoftenOptions> = {},
): RawImage {
	const opts = { ...DEFAULT_SOFTEN_OPTIONS, ...options };
	const { width: gridW, height: gridH } = source;
	const cell = opts.cellSize;
	const outW = gridW * cell;
	const outH = gridH * cell;
	const cells = readCells(source);

	const neighborLuminance = (
		cx: number,
		cy: number,
		dx: number,
		dy: number,
		self: Cell,
	): number => {
		const nx = cx + dx;
		const ny = cy + dy;
		if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) return self.luminance;
		const neighbor = cells[ny * gridW + nx];
		return !neighbor || neighbor.alpha === 0
			? self.luminance
			: neighbor.luminance;
	};

	const data = Buffer.alloc(outW * outH * 4);

	for (let cy = 0; cy < gridH; cy++) {
		for (let cx = 0; cx < gridW; cx++) {
			const self = cells[cy * gridW + cx];
			if (!self || self.alpha === 0) continue;

			const gx =
				(neighborLuminance(cx, cy, 1, 0, self) -
					neighborLuminance(cx, cy, -1, 0, self)) /
				255;
			const gy =
				(neighborLuminance(cx, cy, 0, 1, self) -
					neighborLuminance(cx, cy, 0, -1, self)) /
				255;

			const jitterSeed = opts.seed + cx * 92821 + cy * 68917;
			const jitter = {
				r: signedNoise(cx, cy, jitterSeed) * opts.jitterStrength,
				g: signedNoise(cx, cy, jitterSeed + 1) * opts.jitterStrength,
				b: signedNoise(cx, cy, jitterSeed + 2) * opts.jitterStrength,
			};

			for (let py = 0; py < cell; py++) {
				const v = (py + 0.5) / cell - 0.5; // [-0.5, 0.5)
				for (let px = 0; px < cell; px++) {
					const u = (px + 0.5) / cell - 0.5;
					const shade = 1 + opts.gradientStrength * (u * gx + v * gy) * 2;

					const x = cx * cell + px;
					const y = cy * cell + py;
					const grain = signedNoise(x, y, opts.seed + 7) * opts.grainStrength;

					const idx = (y * outW + x) * 4;
					data[idx] = clamp255((self.rgb.r + jitter.r) * shade + grain);
					data[idx + 1] = clamp255((self.rgb.g + jitter.g) * shade + grain);
					data[idx + 2] = clamp255((self.rgb.b + jitter.b) * shade + grain);
					data[idx + 3] = 255;
				}
			}
		}
	}

	applyBloom(data, outW, outH, opts);
	featherEdges(data, outW, outH, opts.edgeFeatherPx);

	return { data, width: outW, height: outH };
}

function applyBloom(
	data: Buffer,
	width: number,
	height: number,
	opts: SoftenOptions,
): void {
	const bright = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) {
		const p = i * 4;
		const alpha = data[p + 3] ?? 0;
		if (alpha === 0) continue;
		const lum = luminance({
			r: data[p] ?? 0,
			g: data[p + 1] ?? 0,
			b: data[p + 2] ?? 0,
		});
		bright[i] = clamp255(Math.max(0, lum - opts.bloomThreshold) * 3);
	}
	const blurred = featherMask(bright, width, height, opts.bloomRadiusPx);

	for (let i = 0; i < width * height; i++) {
		const glow = (blurred[i] ?? 0) * opts.bloomStrength;
		if (glow <= 0) continue;
		const p = i * 4;
		const currentAlpha = data[p + 3] ?? 0;
		if (currentAlpha > 0) {
			data[p] = clamp255((data[p] ?? 0) + glow);
			data[p + 1] = clamp255((data[p + 1] ?? 0) + glow);
			data[p + 2] = clamp255((data[p + 2] ?? 0) + glow);
		} else {
			// Glow bleeding past the silhouette into background: paint a dim,
			// desaturating tint of the glow color itself with alpha proportional
			// to bloom strength, rather than an opaque disc.
			data[p] = clamp255(glow);
			data[p + 1] = clamp255(glow);
			data[p + 2] = clamp255(glow);
			data[p + 3] = clamp255(Math.max(currentAlpha, glow * 0.6));
		}
	}
}

function featherEdges(
	data: Buffer,
	width: number,
	height: number,
	radiusPx: number,
): void {
	if (radiusPx <= 0) return;
	const alpha = new Uint8Array(width * height);
	for (let i = 0; i < width * height; i++) alpha[i] = data[i * 4 + 3] ?? 0;
	const softened = featherMask(alpha, width, height, radiusPx);
	for (let i = 0; i < width * height; i++) {
		data[i * 4 + 3] = softened[i] ?? 0;
	}
}

// ---- script entrypoint: batch-soften the calibration cabin + placeholders ----

interface SoftenJob {
	inputPath: string;
	outputPath: string;
	options?: Partial<SoftenOptions>;
}

async function runJob(job: SoftenJob): Promise<void> {
	const source = await loadRawRgba(job.inputPath);
	const result = soften(source, job.options);
	await writeRawRgbaPng(result, job.outputPath);
	console.log(
		`softened ${path.basename(job.inputPath)} -> ${path.basename(job.outputPath)} (${result.width}x${result.height})`,
	);
}

async function main() {
	const manifest: Record<string, { locked: boolean }> = JSON.parse(
		await readFile(path.join(generatedDir, "manifest.json"), "utf8"),
	);

	const jobs: SoftenJob[] = [
		{
			inputPath: path.join(recoveredDir, "cabin_64.png"),
			outputPath: path.join(
				generatedDir,
				"soften-calibration",
				"cabin_soft.png",
			),
		},
	];

	// Ghost's whole body sits above the default bloom threshold (it's drawn in
	// near-white curated tones to begin with), which blew the default settings
	// out to a flat white wash — raise the threshold and dial back strength so
	// the glow reads as "faint", not "overexposed".
	const perNameOptions: Record<string, Partial<SoftenOptions>> = {
		ghost: { bloomThreshold: 225, bloomStrength: 0.25, bloomRadiusPx: 5 },
	};

	for (const name of [
		"portal_arch",
		"ghost",
		"character_idle",
		"character_idle_back",
		"wizard_tower",
	]) {
		if (manifest[name]?.locked) continue;
		jobs.push({
			inputPath: path.join(placeholdersDir, `${name}.png`),
			outputPath: path.join(placeholdersDir, `${name}_soft.png`),
			options: perNameOptions[name],
		});
	}

	await mkdir(path.join(generatedDir, "soften-calibration"), {
		recursive: true,
	});

	for (const job of jobs) await runJob(job);
}

// Guard the script's file I/O behind a direct-execution check — this module
// is also imported as a library (by tests, and for the soften() function
// itself), and importing it must not have side effects.
const isMain =
	process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
