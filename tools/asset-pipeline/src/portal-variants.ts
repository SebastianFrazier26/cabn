import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RGB } from "./color.js";
import { composeSheet, compositeInto, type RawImage } from "./image-io.js";
import { writeJsonFile } from "./json-io.js";
import { generatedDir, paletteJsonPath, placeholdersDir } from "./paths.js";
import { renderPixelMap } from "./pixelmap.js";
import { PORTAL_STRIP_FRAME_PX, portalArch } from "./pixelmaps/portal-arch.js";
import {
	ARCH_VARIANT_IDS,
	archVariantLabel,
	portalVariantMap,
} from "./pixelmaps/portal-variants.js";
import { soften } from "./soften.js";

/**
 * Portal-type overlay sheet (2026-09-28). Each variant ships as a static
 * 256px overlay holding only the pixels where the softened variant arch
 * differs from the softened base arch; the engine stacks it on the shared
 * animated base strip. Design choice: one 20-frame overlay sheet (~5 MiB of
 * texture) instead of a full 6-frame strip per variant (~31 MiB) — the motes
 * only ever animate inside the opening, which no variant changes, so a
 * per-variant animated strip would be 6 copies of the same stone.
 */
const VARIANT_SHEET_COLS = 5;
const SHEET_FILE = "portal_arch_variants_soft.png";
const INDEX_FILE = "portal_arch_variants.json";
const REVIEW_DIR = path.join(generatedDir, "review", "portal-types");

async function resizeTo(image: RawImage, size: number): Promise<RawImage> {
	const data = await sharp(image.data, {
		raw: { width: image.width, height: image.height, channels: 4 },
	})
		.resize(size, size)
		.raw()
		.toBuffer();
	return { data, width: size, height: size };
}

async function softFrame(
	map: Parameters<typeof renderPixelMap>[0],
	palette: RGB[],
): Promise<RawImage> {
	return resizeTo(soften(renderPixelMap(map, palette)), PORTAL_STRIP_FRAME_PX);
}

/** Variant pixels wherever they differ from the base at all; transparent elsewhere, so base + overlay reproduces the variant. */
function diffOverlay(base: RawImage, variant: RawImage): RawImage {
	const data = Buffer.alloc(variant.data.length);
	for (let p = 0; p < data.length; p += 4) {
		let same = true;
		for (let c = 0; c < 4; c++) {
			if (base.data[p + c] !== variant.data[p + c]) same = false;
		}
		if (same) continue;
		variant.data.copy(data, p, p, p + 4);
	}
	return { data, width: variant.width, height: variant.height };
}

function solid(width: number, height: number, rgb: RGB): RawImage {
	const data = Buffer.alloc(width * height * 4);
	for (let p = 0; p < data.length; p += 4) {
		data[p] = rgb.r;
		data[p + 1] = rgb.g;
		data[p + 2] = rgb.b;
		data[p + 3] = 255;
	}
	return { data, width, height };
}

/**
 * Rough stand-in for the engine's night (render/atmosphere.ts multiply grade
 * + indigo wash, with the glow pipeline's lowered bloom threshold letting the
 * brightest inks through) — only for the contact sheet; the in-world night
 * screenshots are the real check.
 */
function nightGrade(image: RawImage): RawImage {
	const out = Buffer.from(image.data);
	const wash = [0x15, 0x1a, 0x45] as const;
	const grade = [0.42, 0.46, 0.68] as const;
	for (let p = 0; p < out.length; p += 4) {
		const r = image.data[p] ?? 0;
		const g = image.data[p + 1] ?? 0;
		const b = image.data[p + 2] ?? 0;
		const lum = 0.299 * r + 0.587 * g + 0.114 * b;
		const emissive = Math.max(0, Math.min(1, (lum - 150) / 70));
		[r, g, b].forEach((v, i) => {
			const graded = v * (grade[i] ?? 1) * 0.58 + (wash[i] ?? 0) * 0.42;
			out[p + i] = Math.round(graded * (1 - emissive) + v * 0.9 * emissive);
		});
	}
	return { data: out, width: image.width, height: image.height };
}

async function writeContactSheet(
	frames: { label: string; image: RawImage }[],
	outPath: string,
	ground: RGB,
	night: boolean,
): Promise<void> {
	const cols = 7;
	const cell = PORTAL_STRIP_FRAME_PX;
	const labelH = 28;
	const rows = Math.ceil(frames.length / cols);
	const sheet = solid(cols * cell, rows * (cell + labelH), ground);
	frames.forEach(({ image }, i) => {
		compositeInto(
			sheet,
			image,
			(i % cols) * cell,
			Math.floor(i / cols) * (cell + labelH),
		);
	});
	const graded = night ? nightGrade(sheet) : sheet;
	const labels = frames
		.map(({ label }, i) => {
			const x = (i % cols) * cell + cell / 2;
			const y = Math.floor(i / cols) * (cell + labelH) + cell + 19;
			const escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;");
			return `<text x="${x}" y="${y}" text-anchor="middle">${escaped}</text>`;
		})
		.join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${graded.width}" height="${graded.height}"><style>text{font:600 15px Menlo, monospace;fill:${night ? "#dfe6ff" : "#2a2016"}}</style>${labels}</svg>`;
	await sharp(graded.data, {
		raw: { width: graded.width, height: graded.height, channels: 4 },
	})
		.composite([{ input: Buffer.from(svg) }])
		.png()
		.toFile(outPath);
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);

	const base = await softFrame(portalArch, palette);
	const overlays: RawImage[] = [];
	const composites: { label: string; image: RawImage }[] = [
		{ label: "generic", image: base },
	];
	for (const id of ARCH_VARIANT_IDS) {
		const variant = await softFrame(portalVariantMap(id), palette);
		const overlay = diffOverlay(base, variant);
		overlays.push(overlay);
		const composite: RawImage = {
			data: Buffer.from(base.data),
			width: base.width,
			height: base.height,
		};
		compositeInto(composite, overlay, 0, 0);
		composites.push({ label: archVariantLabel(id), image: composite });
	}

	const sheet = composeSheet(overlays, VARIANT_SHEET_COLS);
	// Max zlib effort: the sheet is 80% transparent, and sharp's default
	// level ships it ~6x larger (749 KB vs ~128 KB), all of it on first load.
	await sharp(sheet.data, {
		raw: { width: sheet.width, height: sheet.height, channels: 4 },
	})
		.png({ compressionLevel: 9, effort: 10 })
		.toFile(path.join(placeholdersDir, SHEET_FILE));
	const index = {
		frameSize: PORTAL_STRIP_FRAME_PX,
		cols: VARIANT_SHEET_COLS,
		variants: ARCH_VARIANT_IDS.map((id, frame) => ({
			id,
			frame,
			label: archVariantLabel(id),
		})),
	};
	await writeJsonFile(path.join(placeholdersDir, INDEX_FILE), index);

	await mkdir(REVIEW_DIR, { recursive: true });
	await writeContactSheet(
		composites,
		path.join(REVIEW_DIR, "contact-sheet-day.png"),
		{ r: 120, g: 200, b: 90 },
		false,
	);
	await writeContactSheet(
		composites,
		path.join(REVIEW_DIR, "contact-sheet-night.png"),
		{ r: 120, g: 200, b: 90 },
		true,
	);

	console.log(
		`Wrote ${ARCH_VARIANT_IDS.length} portal-type overlays to ${path.join(placeholdersDir, SHEET_FILE)} and contact sheets to ${REVIEW_DIR}`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
