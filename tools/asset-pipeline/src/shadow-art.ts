import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { RGB } from "./color.js";
import {
	composeSheet,
	compositeInto,
	concatHorizontal,
	loadRawRgba,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import { generatedDir, paletteJsonPath, placeholdersDir } from "./paths.js";
import { type Grid, toPixelMap } from "./pixel-shapes.js";
import { type PixelMap, renderPixelMap } from "./pixelmap.js";
import {
	ashFlakes,
	basaltPillar,
	brazierFrame,
	lavaPathPieces,
	lavaPond,
	magmaRock,
	netherArchFrame,
	netherDecals,
	netherrackTileFrames,
	obsidianTileFrames,
	PORTAL_FRAME_COUNT,
	runeOverlayFrame,
	sudoIconGrid,
} from "./shadow/grids.js";
import { netherIcons } from "./shadow/icons.js";
import { netherMonsters } from "./shadow/monsters.js";
import { buildNetherPalette, type NetherPalette } from "./shadow/palette.js";
import {
	type NetherVariant,
	netherProps,
	netherScenery,
	netherSkyline,
} from "./shadow/props.js";
import {
	DEFAULT_SOFTEN_OPTIONS,
	MONSTER_SOFTEN_OVERRIDES,
	type SoftenOptions,
	soften,
} from "./soften.js";
import { WORLD_FOUNTAIN_FRAME_COUNT } from "./world-art/world-fountain.js";

/**
 * Shadow realm (M3) art: owner-only textures written to assets/generated/
 * shadow/, a folder only `cabn serve --owner` serves and the demo build never
 * copies. Every sprite goes through the same grid -> renderPixelMap -> soften
 * path as the normal world art, with fixed seeds so reruns are byte-identical.
 */
export const shadowDir = path.join(generatedDir, "shadow");
const reviewDir = path.join(generatedDir, "review", "shadow-m3");

/** gen-world-art.ts's settings for flat world art: no jitter/grain speckle. */
function worldSoften(cellSize: number, seed: number, edgeFeatherPx = 1) {
	return {
		...DEFAULT_SOFTEN_OPTIONS,
		cellSize,
		jitterStrength: 0,
		grainStrength: 0,
		bloomStrength: 0.12,
		bloomThreshold: 235,
		edgeFeatherPx,
		seed,
	};
}

interface Pair {
	crisp: RawImage;
	soft: RawImage;
}

function renderGrid(
	grid: Grid,
	name: string,
	pal: NetherPalette,
	opts: SoftenOptions,
): Pair {
	return renderMap(toPixelMap(name, grid), pal, opts);
}

function renderMap(
	map: PixelMap,
	pal: NetherPalette,
	opts: SoftenOptions,
): Pair {
	const crisp = renderPixelMap(map, pal.colors);
	return { crisp, soft: soften(crisp, opts) };
}

const out = (name: string) => path.join(shadowDir, name);

async function writePair(
	name: string,
	pair: Pair,
	upscale: number,
): Promise<void> {
	await writeRawRgbaPng(
		await upscaleNearest(pair.crisp, upscale),
		out(`${name}.png`),
	);
	await writeRawRgbaPng(pair.soft, out(`${name}_soft.png`));
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

/** A smooth vertical gradient, the same deliberate non-pixel exception as the normal sky_day/sky_night. */
function skyGradient(top: RGB, horizon: RGB): RawImage {
	const width = 4;
	const height = 128;
	const data = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++) {
		const t = (y / (height - 1)) ** 1.6;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = Math.round(top.r + (horizon.r - top.r) * t);
			data[i + 1] = Math.round(top.g + (horizon.g - top.g) * t);
			data[i + 2] = Math.round(top.b + (horizon.b - top.b) * t);
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

/** The spark dot's falloff with a hot, nearly-opaque core, so tinted embers read as burning points rather than soft motes. */
function emberDot(): RawImage {
	const size = 16;
	const data = Buffer.alloc(size * size * 4);
	const c = size / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const d = Math.hypot((x + 0.5 - c) / c, (y + 0.5 - c) / c);
			const glow = Math.max(0, 1 - d) ** 1.8;
			const core = Math.max(0, 1 - d / 0.35);
			const i = (y * size + x) * 4;
			data[i] = 255;
			data[i + 1] = Math.round(236 + 19 * core);
			data[i + 2] = Math.round(196 + 59 * core);
			data[i + 3] = Math.round(Math.min(1, glow + core * 0.6) * 255);
		}
	}
	return { data, width: size, height: size };
}

/**
 * Tileable parchment: only integer-frequency sin/cos terms over the 64px
 * period, so every edge meets its opposite exactly; low amplitude keeps code
 * text on it as readable as on the plain parchment colour.
 */
function scorchedParchment(): RawImage {
	const size = 64;
	const data = Buffer.alloc(size * size * 4);
	const w = (Math.PI * 2) / size;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const mottle =
				Math.sin(x * w * 2 + 1.3) * Math.cos(y * w * 3 + 0.4) * 0.5 +
				Math.sin(x * w * 5 + y * w * 2 + 2.1) * 0.3 +
				Math.cos(x * w * 1 - y * w * 4 + 0.7) * 0.2;
			const fibre =
				Math.max(0, 1 - Math.abs(Math.sin(x * w * 1 + y * w * 3 + 0.9)) * 18) *
					0.6 +
				Math.max(0, 1 - Math.abs(Math.sin(x * w * 4 - y * w * 1 + 2.4)) * 22) *
					0.4;
			const dark = mottle * 5 + fibre * 9;
			const i = (y * size + x) * 4;
			data[i] = Math.round(240 - dark);
			data[i + 1] = Math.round(200 - dark * 1.1);
			data[i + 2] = Math.round(186 - dark * 1.05);
			data[i + 3] = 255;
		}
	}
	return { data, width: size, height: size };
}

/** Runtime file -> image, in review-sheet order. */
type Runtime = [file: string, image: RawImage][];

async function genTiles(pal: NetherPalette, runtime: Runtime): Promise<void> {
	for (const [name, frames, seedBase] of [
		["netherrack_tiles", netherrackTileFrames(pal.n), 20262000],
		["obsidian_tiles", obsidianTileFrames(pal.n), 20262100],
	] as const) {
		const pairs = frames.map((grid, i) =>
			renderGrid(grid, `${name}_${i}`, pal, worldSoften(2, seedBase + i, 2)),
		);
		const cols = 5;
		const crisp = composeSheet(
			pairs.map((p) => p.crisp),
			cols,
		);
		const soft = composeSheet(
			pairs.map((p) => p.soft),
			cols,
		);
		await writePair(name, { crisp, soft }, 4);
		runtime.push([`${name}_soft.png`, soft]);
	}
}

async function genDecals(pal: NetherPalette, runtime: Runtime): Promise<void> {
	const pairs = netherDecals(pal).map((d, i) =>
		renderGrid(
			d.grid,
			`nether_decal_${d.name}`,
			pal,
			worldSoften(2, 20262200 + i),
		),
	);
	const cols = pairs.length;
	const soft = composeSheet(
		pairs.map((p) => p.soft),
		cols,
	);
	await writePair(
		"nether_decals",
		{
			crisp: composeSheet(
				pairs.map((p) => p.crisp),
				cols,
			),
			soft,
		},
		4,
	);
	runtime.push(["nether_decals_soft.png", soft]);
}

async function genPath(pal: NetherPalette, runtime: Runtime): Promise<void> {
	for (const [i, piece] of lavaPathPieces(pal.n).entries()) {
		const slug = `path_${piece.name.replace(/-/g, "_")}`;
		const pair = renderGrid(
			piece.grid,
			slug,
			pal,
			worldSoften(2, 20262300 + i, 0),
		);
		await writePair(slug, pair, 6);
		runtime.push([`${slug}_soft.png`, pair.soft]);
	}
}

async function genArch(pal: NetherPalette, runtime: Runtime): Promise<void> {
	const crisp: RawImage[] = [];
	const soft: RawImage[] = [];
	for (let i = 0; i < PORTAL_FRAME_COUNT; i++) {
		const pair = renderMap(
			netherArchFrame(pal, i),
			pal,
			DEFAULT_SOFTEN_OPTIONS,
		);
		crisp.push(await upscaleNearest(pair.crisp, 8));
		soft.push(await resizeTo(pair.soft, 256));
	}
	await writeRawRgbaPng(
		concatHorizontal(crisp),
		out("portal_arch_nether_strip.png"),
	);
	const strip = concatHorizontal(soft);
	await writeRawRgbaPng(strip, out("portal_arch_nether_strip_soft.png"));
	runtime.push(["portal_arch_nether_strip_soft.png", strip]);

	const runeCrisp: RawImage[] = [];
	const runeSoft: RawImage[] = [];
	for (const pulse of [0, 1] as const) {
		const pair = renderMap(runeOverlayFrame(pal, pulse), pal, {
			...DEFAULT_SOFTEN_OPTIONS,
			bloomThreshold: 120,
			bloomStrength: pulse === 0 ? 0.55 : 0.8,
			seed: 20262400,
		});
		runeCrisp.push(await upscaleNearest(pair.crisp, 8));
		runeSoft.push(await resizeTo(pair.soft, 256));
	}
	await writeRawRgbaPng(
		concatHorizontal(runeCrisp),
		out("portal_arch_rune_overlay.png"),
	);
	const runes = concatHorizontal(runeSoft);
	await writeRawRgbaPng(runes, out("portal_arch_rune_overlay_soft.png"));
	runtime.push(["portal_arch_rune_overlay_soft.png", runes]);
}

async function genBrazier(pal: NetherPalette, runtime: Runtime): Promise<void> {
	const pairs: Pair[] = [];
	for (let i = 0; i < WORLD_FOUNTAIN_FRAME_COUNT; i++) {
		// One seed for every frame (as the fountain does) so only the flames
		// change between frames, never the stone's softened edge.
		pairs.push(
			renderGrid(brazierFrame(pal, i), `prop_nether_brazier_f${i}`, pal, {
				...worldSoften(2, 20262500),
				bloomThreshold: 200,
				bloomStrength: 0.3,
			}),
		);
	}
	const soft = concatHorizontal(pairs.map((p) => p.soft));
	await writePair(
		"prop_nether_brazier_strip",
		{ crisp: concatHorizontal(pairs.map((p) => p.crisp)), soft },
		8,
	);
	runtime.push(["prop_nether_brazier_strip_soft.png", soft]);
}

async function genIcon(pal: NetherPalette, runtime: Runtime): Promise<void> {
	const pair = renderGrid(sudoIconGrid(pal), "ui_icon_sudo", pal, {
		...DEFAULT_SOFTEN_OPTIONS,
		seed: 20262600,
		bloomThreshold: 200,
		bloomStrength: 0.35,
	});
	await writeRawRgbaPng(pair.crisp, out("ui_icon_sudo.png"));
	await writeRawRgbaPng(
		await upscaleNearest(pair.crisp, 8),
		out("ui_icon_sudo@8x.png"),
	);
	await writeRawRgbaPng(pair.soft, out("ui_icon_sudo_soft.png"));
	runtime.push(["ui_icon_sudo_soft.png", pair.soft]);
}

async function genScenery(pal: NetherPalette, runtime: Runtime): Promise<void> {
	const pieces: [string, Grid, number][] = [
		["scenery_basalt_pillar", basaltPillar(pal.n), 20262701],
		["scenery_magma_rock", magmaRock(pal.n), 20262702],
		["scenery_lava_pond", lavaPond(pal.n), 20262703],
	];
	for (const [slug, grid, seed] of pieces) {
		const pair = renderGrid(grid, slug, pal, worldSoften(2, seed));
		await writePair(slug, pair, 8);
		runtime.push([`${slug}_soft.png`, pair.soft]);
	}
}

interface VariantGroup {
	prefix: "prop" | "scenery" | "skyline";
	variants: NetherVariant[];
	upscale: number;
	/** The multiply tint the realm used to lay over the normal art, for the before/after sheet. */
	oldTint: RGB;
	/** The normal art's runtime file for a variant slug. */
	baseFile: (slug: string) => string;
}

function variantGroups(pal: NetherPalette): VariantGroup[] {
	const scatter = { r: 0x7a, g: 0x4a, b: 0x44 };
	return [
		{
			prefix: "prop",
			variants: netherProps(pal),
			upscale: 8,
			oldTint: scatter,
			baseFile: (slug) => `prop_${slug}_soft.png`,
		},
		{
			prefix: "scenery",
			variants: netherScenery(pal),
			upscale: 8,
			oldTint: scatter,
			baseFile: (slug) => `scenery_${slug}_soft.png`,
		},
		{
			prefix: "skyline",
			variants: netherSkyline(pal),
			upscale: 4,
			oldTint: { r: 0xc8, g: 0x60, b: 0x4c },
			baseFile: (slug) => `skyline_${slug}_day_soft.png`,
		},
	];
}

const variantSlug = (name: string) => name.replace(/-/g, "_");

async function genVariants(
	pal: NetherPalette,
	runtime: Runtime,
): Promise<void> {
	for (const [g, group] of variantGroups(pal).entries()) {
		for (const [i, v] of group.variants.entries()) {
			const slug = `${group.prefix}_${variantSlug(v.name)}_nether`;
			const pair = renderGrid(
				v.grid,
				slug,
				pal,
				worldSoften(v.cellSize, 20263000 + g * 100 + i),
			);
			await writePair(slug, pair, group.upscale);
			runtime.push([`${slug}_soft.png`, pair.soft]);
		}
	}
}

function multiplied(image: RawImage, tint: RGB): RawImage {
	const data = Buffer.from(image.data);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = Math.round(((data[i] ?? 0) * tint.r) / 255);
		data[i + 1] = Math.round(((data[i + 1] ?? 0) * tint.g) / 255);
		data[i + 2] = Math.round(((data[i + 2] ?? 0) * tint.b) / 255);
	}
	return { data, width: image.width, height: image.height };
}

/** Normal art | what the realm showed (multiply tint) | the nether variant, for every swapped piece. */
async function genBeforeAfter(pal: NetherPalette): Promise<void> {
	const cells: RawImage[] = [];
	for (const group of variantGroups(pal)) {
		for (const v of group.variants) {
			const slug = variantSlug(v.name);
			const base = await loadRawRgba(
				path.join(placeholdersDir, group.baseFile(slug)),
			);
			const nether = await loadRawRgba(
				out(`${group.prefix}_${slug}_nether_soft.png`),
			);
			const scale = Math.max(base.width, base.height) <= 80 ? 2 : 1;
			const shown = [base, multiplied(base, group.oldTint), nether];
			const pad = 6;
			const w = base.width * scale;
			const h = base.height * scale;
			const cell = solid(w * 3 + pad * 4, h + pad * 2, { r: 60, g: 52, b: 56 });
			for (const [k, image] of shown.entries()) {
				const up = scale > 1 ? await upscaleNearest(image, scale) : image;
				compositeInto(cell, up, pad + k * (w + pad), pad);
			}
			cells.push(cell);
		}
	}
	const sheetWidth = 1600;
	const gap = 10;
	const placed: [RawImage, number, number][] = [];
	let x = gap;
	let y = gap;
	let rowH = 0;
	for (const cell of cells) {
		if (x + cell.width + gap > sheetWidth && x > gap) {
			x = gap;
			y += rowH + gap;
			rowH = 0;
		}
		placed.push([cell, x, y]);
		x += cell.width + gap;
		rowH = Math.max(rowH, cell.height);
	}
	const sheet = solid(sheetWidth, y + rowH + gap, { r: 24, g: 18, b: 22 });
	for (const [cell, cx, cy] of placed) compositeInto(sheet, cell, cx, cy);
	await writeRawRgbaPng(sheet, path.join(reviewDir, "props-before-after.png"));
}

/** Idle, hit and defeat frames of every species as the nether shows them, softened like the normal set (gen-placeholders + soften.ts). */
async function genMonsters(pal: NetherPalette): Promise<void> {
	const overrides: Record<
		string,
		Partial<SoftenOptions>
	> = MONSTER_SOFTEN_OVERRIDES;
	for (const m of netherMonsters(pal)) {
		for (const map of [...m.idle, m.hit, ...m.defeat]) {
			const crisp = renderPixelMap(map, pal.colors);
			await writePair(
				map.name,
				{ crisp, soft: soften(crisp, overrides[m.slug] ?? {}) },
				8,
			);
		}
	}
}

async function genIcons(pal: NetherPalette, runtime: Runtime): Promise<void> {
	for (const icon of netherIcons(pal)) {
		const crisp = renderPixelMap(icon.map, pal.colors);
		const soft = soften(crisp, icon.soften ?? {});
		await writePair(icon.map.name, { crisp, soft }, 8);
		runtime.push([`${icon.map.name}_soft.png`, soft]);
	}
}

async function fitHeight(image: RawImage, height: number): Promise<RawImage> {
	const width = Math.round((image.width * height) / image.height);
	const data = await sharp(image.data, {
		raw: { width: image.width, height: image.height, channels: 4 },
	})
		.resize(width, height)
		.raw()
		.toBuffer();
	return { data, width, height };
}

/** Normal vs nether, every species: idle0, idle1, hit, defeat0-2 on the ground each is seen on. */
async function genMonsterSheet(pal: NetherPalette): Promise<void> {
	const cellH = 96;
	const pad = 8;
	const rows: RawImage[] = [];
	for (const m of netherMonsters(pal)) {
		const frameNames =
			m.idle.length === 1
				? [m.slug, null]
				: [`${m.slug}_idle0`, `${m.slug}_idle1`];
		const normalFiles = [
			...frameNames,
			`${m.slug}_hit`,
			...[0, 1, 2].map((i) => `${m.slug}_defeat${i}`),
		];
		const netherFiles = [
			...m.idle.map((f) => f.name),
			...(m.idle.length === 1 ? [null] : []),
			m.hit.name,
			...m.defeat.map((f) => f.name),
		];
		const halves: [string | null, (string | null)[], RGB][] = [
			[placeholdersDir, normalFiles, { r: 96, g: 150, b: 72 }],
			[shadowDir, netherFiles, { r: 112, g: 30, b: 30 }],
		];
		const first = await loadRawRgba(
			path.join(placeholdersDir, `${normalFiles[0]}_soft.png`),
		);
		const cellW = Math.round((first.width * cellH) / first.height);
		const row = solid((cellW + pad) * 12 + pad * 3, cellH + pad * 2, {
			r: 24,
			g: 18,
			b: 22,
		});
		for (const [h, [dir, files, ground]] of halves.entries()) {
			const x0 = pad + h * ((cellW + pad) * 6 + pad * 2);
			compositeInto(
				row,
				solid((cellW + pad) * 6 + pad, cellH + pad * 2, ground),
				x0 - pad / 2,
				0,
			);
			for (const [i, file] of files.entries()) {
				if (!file || !dir) continue;
				const image = await fitHeight(
					await loadRawRgba(path.join(dir, `${file}_soft.png`)),
					cellH,
				);
				compositeInto(row, image, x0 + i * (cellW + pad), pad);
			}
		}
		rows.push(row);
	}
	const width = Math.max(...rows.map((r) => r.width));
	const sheet = solid(
		width,
		rows.reduce((sum, r) => sum + r.height + 4, 4),
		{ r: 24, g: 18, b: 22 },
	);
	let y = 4;
	for (const r of rows) {
		compositeInto(sheet, r, 0, y);
		y += r.height + 4;
	}
	await writeRawRgbaPng(
		sheet,
		path.join(reviewDir, "monsters-normal-nether.png"),
	);
}

async function genFx(pal: NetherPalette, runtime: Runtime): Promise<void> {
	const flakes = ashFlakes(pal.n).map(
		(grid, i) =>
			renderGrid(grid, `fx_ash_${i}`, pal, worldSoften(2, 20262800 + i)).soft,
	);
	const ash = concatHorizontal(flakes);
	await writeRawRgbaPng(ash, out("fx_ash.png"));
	runtime.push(["fx_ash.png", ash]);
	const ember = emberDot();
	await writeRawRgbaPng(ember, out("fx_ember.png"));
	runtime.push(["fx_ember.png", ember]);
	const sky = skyGradient({ r: 30, g: 6, b: 12 }, { r: 228, g: 86, b: 36 });
	await writeRawRgbaPng(sky, out("sky_ember.png"));
	runtime.push(["sky_ember.png", sky]);
	const parchment = scorchedParchment();
	await writeRawRgbaPng(parchment, out("parchment_scorched.png"));
	runtime.push(["parchment_scorched.png", parchment]);
}

function solid(width: number, height: number, rgb: RGB): RawImage {
	const data = Buffer.alloc(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = rgb.r;
		data[i + 1] = rgb.g;
		data[i + 2] = rgb.b;
		data[i + 3] = 255;
	}
	return { data, width, height };
}

/** Every runtime file on a dark and a light swatch, shelf-packed into one image. */
async function genReview(runtime: Runtime): Promise<void> {
	const sheetWidth = 1600;
	const gap = 12;
	const tiles: RawImage[] = [];
	for (const [file, image] of runtime) {
		let shown = image;
		if (file === "sky_ember.png") {
			const data = await sharp(image.data, {
				raw: { width: image.width, height: image.height, channels: 4 },
			})
				.resize(64, 128, { kernel: "nearest" })
				.raw()
				.toBuffer();
			shown = { data, width: 64, height: 128 };
		} else if (Math.max(image.width, image.height) <= 64) {
			shown = await upscaleNearest(image, 4);
		} else if (Math.max(image.width, image.height) <= 160) {
			shown = await upscaleNearest(image, 2);
		}
		const pad = 8;
		const tile = solid(shown.width + pad * 2, shown.height * 2 + pad * 4, {
			r: 232,
			g: 224,
			b: 216,
		});
		compositeInto(
			tile,
			solid(shown.width + pad * 2, shown.height + pad * 2, {
				r: 26,
				g: 18,
				b: 22,
			}),
			0,
			0,
		);
		compositeInto(tile, shown, pad, pad);
		compositeInto(tile, shown, pad, shown.height + pad * 3);
		tiles.push(tile);
	}
	const placed: [RawImage, number, number][] = [];
	let x = gap;
	let y = gap;
	let rowH = 0;
	for (const tile of tiles) {
		if (x + tile.width + gap > sheetWidth && x > gap) {
			x = gap;
			y += rowH + gap;
			rowH = 0;
		}
		placed.push([tile, x, y]);
		x += tile.width + gap;
		rowH = Math.max(rowH, tile.height);
	}
	const sheet = solid(sheetWidth, y + rowH + gap, { r: 90, g: 84, b: 90 });
	for (const [tile, tx, ty] of placed) compositeInto(sheet, tile, tx, ty);
	await writeRawRgbaPng(sheet, path.join(reviewDir, "art-sheet.png"));

	const rows = runtime
		.map(
			([file, image]) =>
				`<tr><td><code>${file}</code></td><td>${image.width}x${image.height}</td><td class="img"><img src="../../shadow/${file}" alt="${file}"></td></tr>`,
		)
		.join("\n");
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>cabn shadow realm M3 art</title>
<style>
body { background: #1a1216; color: #fbe9e4; font-family: monospace; margin: 24px; }
td { padding: 6px 12px; border-bottom: 1px solid #4a2420; vertical-align: middle; }
td.img { background: #3a2a2e; }
img { image-rendering: pixelated; max-width: 900px; }
</style>
</head>
<body>
<h1>Shadow realm (M3) runtime art</h1>
<p>Generated by <code>pnpm -F @cabn/asset-pipeline shadow</code> into <code>assets/generated/shadow/</code>; served only by <code>cabn serve --owner</code>.</p>
<p><img src="art-sheet.png" alt="contact sheet"></p>
<table>
${rows}
</table>
</body>
</html>
`;
	await writeFile(path.join(reviewDir, "index.html"), html);
}

async function main() {
	const base: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	const pal = buildNetherPalette(base);
	await mkdir(shadowDir, { recursive: true });
	await mkdir(reviewDir, { recursive: true });
	const runtime: Runtime = [];
	await genIcon(pal, runtime);
	await genTiles(pal, runtime);
	await genDecals(pal, runtime);
	await genPath(pal, runtime);
	await genArch(pal, runtime);
	await genBrazier(pal, runtime);
	await genScenery(pal, runtime);
	await genVariants(pal, runtime);
	await genIcons(pal, runtime);
	await genMonsters(pal);
	await genFx(pal, runtime);
	await genReview(runtime);
	await genBeforeAfter(pal);
	await genMonsterSheet(pal);
	console.log(`shadow: ${runtime.length} runtime textures -> ${shadowDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
