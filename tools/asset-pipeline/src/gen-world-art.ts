import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import {
	composeSheet,
	compositeInto,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import { generatedDir, paletteJsonPath, placeholdersDir } from "./paths.js";
import { type Grid, toPixelMap } from "./pixel-shapes.js";
import { renderPixelMap } from "./pixelmap.js";
import { DEFAULT_SOFTEN_OPTIONS, soften } from "./soften.js";
import {
	buildBiomeTileFrames,
	VARIANT_COUNT as TILE_VARIANT_COUNT,
} from "./world-art/biome-tiles.js";
import { buildDecals } from "./world-art/decals.js";
import { buildPathStampGrids } from "./world-art/path-stamps-art.js";
import {
	buildCastleKeep,
	buildProps,
	type PropPaletteIndices,
} from "./world-art/props.js";

const worldArtDir = path.join(generatedDir, "world-art");

// Indices into assets/generated/palette.json — hardcoded the same way
// engine/src/palette.ts hardcodes its copy (see that file's own comment):
// this script is the one place regeneration risk lives, not every consumer.
// All "*Bright" entries are the saturated Stardew/Pokémon-style set added
// after the first pass (muted cottagecore tones) was rejected as bland —
// see extract-palette.ts's CURATED_COLORS comment for the full context.
// A few muted entries (ink, parchment, cream) are kept for neutrals that
// were never the problem (mortar lines, parchment/cream highlights).
const PALETTE = {
	ink: 0,
	parchment: 27,
	cream: 29,
	meadowShadow: 40,
	meadowBase: 41,
	meadowHighlight: 42,
	groveShadow: 43,
	groveBase: 44,
	groveHighlight: 45,
	gladeShadow: 46,
	gladeBase: 47,
	gladeHighlight: 48,
	pathShadow: 49,
	pathBase: 50,
	pathHighlight: 51,
	berryPink: 52,
	skyBlue: 53,
	sunYellow: 54,
	mushroomRed: 55,
	autumnOrange: 56,
	autumnOrangeDark: 57,
	stoneLight: 58,
	stoneMid: 59,
	stoneDark: 60,
	woodWarm: 61,
	woodDark: 62,
	woodLight: 63,
	terracotta: 64,
	lanternGlow: 65,
} as const;

const BIOME_GROUND_TONES = {
	meadow: {
		shadow: PALETTE.meadowShadow,
		base: PALETTE.meadowBase,
		highlight: PALETTE.meadowHighlight,
	},
	grove: {
		shadow: PALETTE.groveShadow,
		base: PALETTE.groveBase,
		highlight: PALETTE.groveHighlight,
	},
	glade: {
		shadow: PALETTE.gladeShadow,
		base: PALETTE.gladeBase,
		highlight: PALETTE.gladeHighlight,
	},
} as const;

const DIRT_TONES = {
	shadow: PALETTE.pathShadow,
	base: PALETTE.pathBase,
	highlight: PALETTE.pathHighlight,
} as const;

// Ground tiles/decals/path stamps/props are meant to read as clean, flat
// Stardew-style pixel art with deliberate multi-tone shading baked into the
// grid itself (see biome-tiles.ts) — soften()'s own per-cell jitter/grain
// (tuned for the hero sprites' chunky-bevel look) added visible speckle on
// top of that, which is exactly the "Minecraft dirt" noise the user
// rejected; zeroed out here instead of just turned down. bloom stays
// dialed back since none of this art has bright highlights meant to glow.
function worldArtSoftenOptions(cellSize: number, seed: number) {
	return {
		...DEFAULT_SOFTEN_OPTIONS,
		cellSize,
		jitterStrength: 0,
		grainStrength: 0,
		bloomStrength: 0.12,
		bloomThreshold: 235,
		edgeFeatherPx: 1,
		seed,
	};
}

async function renderSoft(
	grid: Grid,
	name: string,
	palette: RGB[],
	cellSize: number,
	seed: number,
): Promise<{ crisp: RawImage; soft: RawImage }> {
	const map = toPixelMap(name, grid);
	const crisp = renderPixelMap(map, palette);
	const soft = soften(crisp, worldArtSoftenOptions(cellSize, seed));
	return { crisp, soft };
}

async function writePair(
	name: string,
	crisp: RawImage,
	soft: RawImage,
	upscale: number,
): Promise<void> {
	await writeRawRgbaPng(
		await upscaleNearest(crisp, upscale),
		path.join(placeholdersDir, `${name}.png`),
	);
	await writeRawRgbaPng(soft, path.join(placeholdersDir, `${name}_soft.png`));
}

interface BiomeTilesResult {
	index: Record<string, unknown>;
	softFramesByBiome: Record<string, RawImage[]>;
}

async function genBiomeTiles(palette: RGB[]): Promise<BiomeTilesResult> {
	const biomeIndex: Record<string, unknown> = {};
	const softFramesByBiome: Record<string, RawImage[]> = {};
	let biomeSeed = 0;
	for (const [biome, grassTones] of Object.entries(BIOME_GROUND_TONES)) {
		const grids = buildBiomeTileFrames(grassTones, DIRT_TONES);
		biomeSeed += 10_000;

		const crispFrames: RawImage[] = [];
		const softFrames: RawImage[] = [];
		for (const [i, grid] of grids.entries()) {
			const { crisp, soft } = await renderSoft(
				grid,
				`${biome}_tile_${i}`,
				palette,
				2,
				20260928 + biomeSeed + i,
			);
			crispFrames.push(crisp);
			softFrames.push(soft);
		}
		softFramesByBiome[biome] = softFrames;

		const cols = 5;
		await writeRawRgbaPng(
			await upscaleNearest(composeSheet(crispFrames, cols), 4),
			path.join(placeholdersDir, `${biome}_tiles.png`),
		);
		await writeRawRgbaPng(
			composeSheet(softFrames, cols),
			path.join(placeholdersDir, `${biome}_tiles_soft.png`),
		);

		biomeIndex[biome] = {
			sheet: `placeholders/${biome}_tiles_soft.png`,
			frameSize: 32,
			cols,
			rows: Math.ceil(grids.length / cols),
			baseVariantFrames: Array.from(
				{ length: TILE_VARIANT_COUNT },
				(_, i) => i,
			),
			edgeMaskFrameOffset: TILE_VARIANT_COUNT,
		};
	}
	return { index: biomeIndex, softFramesByBiome };
}

interface DecalsResult {
	index: Record<string, unknown>;
	softFrames: RawImage[];
}

async function genDecals(palette: RGB[]): Promise<DecalsResult> {
	const decals = buildDecals({
		blossomPink: PALETTE.berryPink,
		cornflowerBlue: PALETTE.skyBlue,
		butterYellow: PALETTE.sunYellow,
		stemGreen: PALETTE.groveBase,
		leafGreen: PALETTE.meadowBase,
		leafGreenShadow: PALETTE.meadowShadow,
		steelGray: PALETTE.stoneLight,
		coolShadow: PALETTE.stoneDark,
		cream: PALETTE.cream,
		berryRed: PALETTE.mushroomRed,
		emberRed: PALETTE.autumnOrangeDark,
		parchment: PALETTE.parchment,
		leafOrange: PALETTE.autumnOrange,
		leafOrangeShadow: PALETTE.autumnOrangeDark,
	});

	const crispFrames: RawImage[] = [];
	const softFrames: RawImage[] = [];
	for (const [i, decal] of decals.entries()) {
		const { crisp, soft } = await renderSoft(
			decal.grid,
			`decal_${decal.name}`,
			palette,
			2,
			20261000 + i,
		);
		crispFrames.push(crisp);
		softFrames.push(soft);
	}
	const cols = 3;
	await writeRawRgbaPng(
		await upscaleNearest(composeSheet(crispFrames, cols), 4),
		path.join(placeholdersDir, "decals.png"),
	);
	await writeRawRgbaPng(
		composeSheet(softFrames, cols),
		path.join(placeholdersDir, "decals_soft.png"),
	);

	return {
		index: {
			sheet: "placeholders/decals_soft.png",
			frameSize: 24,
			cols,
			rows: Math.ceil(decals.length / cols),
			frames: decals.map((d, i) => ({ index: i, name: d.name })),
		},
		softFrames,
	};
}

interface PathStampsResult {
	index: Record<string, unknown>;
	softFrames: RawImage[];
}

async function genPathStamps(palette: RGB[]): Promise<PathStampsResult> {
	// Cool gray cobblestones with a warm sand edge-stone border — a small,
	// deliberate piece of the "warm/cool mix" the batch-2 review asked for,
	// not just a uniform gray road.
	const grids = buildPathStampGrids(
		PALETTE.stoneMid,
		PALETTE.stoneDark,
		PALETTE.stoneLight,
		PALETTE.pathHighlight,
	);
	const names = ["cobble-a", "cobble-b", "cobble-c"];
	const frames: { index: number; name: string; key: string; file: string }[] =
		[];
	const softFrames: RawImage[] = [];

	for (const [i, grid] of grids.entries()) {
		const name = names[i] ?? `stamp-${i}`;
		const { crisp, soft } = await renderSoft(
			grid,
			`path_stamp_${i}`,
			palette,
			3,
			20261100 + i,
		);
		await writePair(`path_stamp_${i}`, crisp, soft, 6);
		softFrames.push(soft);
		frames.push({
			index: i,
			name,
			key: `path-stamp-${i}`,
			file: `placeholders/path_stamp_${i}_soft.png`,
		});
	}
	return { index: { frames }, softFrames };
}

interface PropsResult {
	index: Record<string, unknown>;
	softFramesByName: Record<string, RawImage>;
}

const PROP_PALETTE: PropPaletteIndices = {
	wood: PALETTE.woodWarm,
	woodDark: PALETTE.woodDark,
	woodLight: PALETTE.woodLight,
	hedgeTones: {
		shadow: PALETTE.groveShadow,
		base: PALETTE.groveBase,
		highlight: PALETTE.groveHighlight,
	},
	stone: PALETTE.stoneMid,
	stoneShadow: PALETTE.stoneDark,
	stoneHighlight: PALETTE.stoneLight,
	glow: PALETTE.lanternGlow,
	glowBright: PALETTE.cream,
	treeTones: {
		shadow: PALETTE.groveShadow,
		base: PALETTE.groveBase,
		highlight: PALETTE.groveHighlight,
	},
	trunk: PALETTE.woodDark,
	blossomAccent: PALETTE.berryPink,
	bushTones: {
		shadow: PALETTE.meadowShadow,
		base: PALETTE.meadowBase,
		highlight: PALETTE.meadowHighlight,
	},
	waterDark: PALETTE.ink,
	plankCream: PALETTE.parchment,
	ink: PALETTE.ink,
	potColor: PALETTE.terracotta,
	potShadow: PALETTE.woodDark,
	dirt: PALETTE.pathShadow,
	petal: PALETTE.berryPink,
	petalCenter: PALETTE.sunYellow,
	stem: PALETTE.groveBase,
	// Warm cottage — terracotta walls, a deeper terracotta roof, a bright
	// window glow (same "bright enough to catch the night bloom threshold"
	// reasoning as lampPost's glow slit — see props.ts).
	wallColor: PALETTE.terracotta,
	wallShadow: PALETTE.woodDark,
	roofColor: PALETTE.autumnOrange,
	roofShadow: PALETTE.autumnOrangeDark,
	windowFrame: PALETTE.woodDark,
	windowGlow: PALETTE.lanternGlow,
	doorColor: PALETTE.woodDark,
	chimneyColor: PALETTE.stoneMid,
	bedBorder: PALETTE.woodWarm,
	bedSoil: PALETTE.pathShadow,
	flagColor: PALETTE.berryPink,
};

async function genProps(palette: RGB[]): Promise<PropsResult> {
	const props = buildProps(PROP_PALETTE);

	const propIndex: { name: string; key: string; file: string }[] = [];
	const softFramesByName: Record<string, RawImage> = {};
	for (const [i, prop] of props.entries()) {
		const slug = prop.name.replace(/-/g, "_");
		const { crisp, soft } = await renderSoft(
			prop.grid,
			`prop_${slug}`,
			palette,
			prop.cellSize,
			20261200 + i,
		);
		await writePair(`prop_${slug}`, crisp, soft, 8);
		softFramesByName[prop.name] = soft;
		propIndex.push({
			name: prop.name,
			key: `prop-${prop.name}`,
			file: `placeholders/prop_${slug}_soft.png`,
		});
	}
	return { index: { props: propIndex }, softFramesByName };
}

interface CastleKeepResult {
	index: Record<string, unknown>;
}

/** The shelf's one-off decorative keep — see props.ts's castleKeep doc comment for why it isn't in the random PROP_NAMES pool. */
async function genCastleKeep(palette: RGB[]): Promise<CastleKeepResult> {
	const prop = buildCastleKeep(PROP_PALETTE);
	const { crisp, soft } = await renderSoft(
		prop.grid,
		"prop_castle_keep",
		palette,
		prop.cellSize,
		20261300,
	);
	await writePair("prop_castle_keep", crisp, soft, 8);
	return {
		index: {
			name: prop.name,
			key: "castle-keep",
			file: "placeholders/prop_castle_keep_soft.png",
		},
	};
}

const MOCK_TILE_SIZE = 32;

/** Same mask/frame math as packages/engine/src/render/groundTiles.ts#tileFrameFor, minus the hashed variant pick (always frame 0) — good enough for a static preview-page mockup, not worth importing the engine package for. */
function mockTileFrame(
	insideAt: (col: number, row: number) => boolean,
	col: number,
	row: number,
): number {
	if (!insideAt(col, row)) return -1;
	let mask = 0;
	if (insideAt(col, row - 1)) mask |= 1;
	if (insideAt(col + 1, row)) mask |= 2;
	if (insideAt(col, row + 1)) mask |= 4;
	if (insideAt(col - 1, row)) mask |= 8;
	return mask === 15 ? 0 : TILE_VARIANT_COUNT + mask;
}

/** A small hand-composed scene — a tiled clearing, scattered decals, a path trailing off one edge, and a few props — assembled directly from the same frames the engine loads, so the preview page has one static image showing how the pieces fit together without needing a browser. */
async function genMockScene(
	meadowFrames: RawImage[],
	decalFrames: RawImage[],
	pathStampFrames: RawImage[],
	propFramesByName: Record<string, RawImage>,
): Promise<void> {
	const cols = 7;
	const rows = 5;
	const originX = 24;
	const originY = 48;
	const canvasW = cols * MOCK_TILE_SIZE + originX * 2;
	const canvasH = rows * MOCK_TILE_SIZE + originY * 2;
	const canvas: RawImage = {
		data: Buffer.alloc(canvasW * canvasH * 4),
		width: canvasW,
		height: canvasH,
	};

	const radiusX = ((cols * MOCK_TILE_SIZE) / 2) * 0.82;
	const radiusY = ((rows * MOCK_TILE_SIZE) / 2) * 0.72;
	const insideAt = (col: number, row: number): boolean => {
		const dx = (col + 0.5 - cols / 2) * MOCK_TILE_SIZE;
		const dy = (row + 0.5 - rows / 2) * MOCK_TILE_SIZE;
		return (dx / radiusX) ** 2 + (dy / radiusY) ** 2 <= 1;
	};

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const frame = mockTileFrame(insideAt, col, row);
			const tile = frame >= 0 ? meadowFrames[frame] : undefined;
			if (!tile) continue;
			compositeInto(
				canvas,
				tile,
				originX + col * MOCK_TILE_SIZE,
				originY + row * MOCK_TILE_SIZE,
			);
		}
	}

	const decalSpots: [number, number][] = [
		[2, 1],
		[4, 2],
		[1, 3],
		[5, 1],
	];
	decalSpots.forEach(([col, row], i) => {
		const decal = decalFrames[i % decalFrames.length];
		if (decal) {
			compositeInto(
				canvas,
				decal,
				originX + col * MOCK_TILE_SIZE + 4,
				originY + row * MOCK_TILE_SIZE + 4,
			);
		}
	});

	for (let i = 0; i < 4; i++) {
		const stamp = pathStampFrames[i % pathStampFrames.length];
		if (stamp) {
			compositeInto(
				canvas,
				stamp,
				Math.round(
					originX + (cols / 2) * MOCK_TILE_SIZE - stamp.width / 2 + i * 6,
				),
				originY + rows * MOCK_TILE_SIZE - 10 + i * 22,
			);
		}
	}

	const tree = propFramesByName["tree-small"];
	if (tree) compositeInto(canvas, tree, originX - 12, originY - 44);
	const fence = propFramesByName.fence;
	if (fence)
		compositeInto(
			canvas,
			fence,
			originX + cols * MOCK_TILE_SIZE - 70,
			originY + 6,
		);
	const well = propFramesByName.well;
	if (well) {
		compositeInto(
			canvas,
			well,
			originX + Math.round((cols / 2 - 1) * MOCK_TILE_SIZE),
			originY + Math.round((rows / 2 - 1.4) * MOCK_TILE_SIZE),
		);
	}

	await writeRawRgbaPng(canvas, path.join(worldArtDir, "mock-scene.png"));
}

const SPARK_TEXTURE_SIZE = 16;

/**
 * A soft white radial-gradient dot — not pixel art at all, deliberately: this
 * is the one shared sprite behind every particle effect (fireflies, motes,
 * bonfire embers, chimney smoke — see render/effects.ts), tinted/scaled per
 * effect at runtime rather than needing a bespoke shape for each. A literal
 * leaf or smoke-puff silhouette wouldn't read any differently at the couple
 * of pixels a particle actually renders at.
 */
function buildSparkTexture(): RawImage {
	const size = SPARK_TEXTURE_SIZE;
	const data = Buffer.alloc(size * size * 4);
	const center = size / 2;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = (x + 0.5 - center) / center;
			const dy = (y + 0.5 - center) / center;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const falloff = Math.max(0, 1 - dist) ** 2;
			const idx = (y * size + x) * 4;
			data[idx] = 255;
			data[idx + 1] = 255;
			data[idx + 2] = 255;
			data[idx + 3] = Math.round(falloff * 255);
		}
	}
	return { data, width: size, height: size };
}

async function main() {
	const palette: RGB[] = JSON.parse(
		await readFile(paletteJsonPath, "utf8"),
	).colors.map((c: { rgb: RGB }) => c.rgb);
	await mkdir(placeholdersDir, { recursive: true });
	await mkdir(worldArtDir, { recursive: true });

	const biomes = await genBiomeTiles(palette);
	const decals = await genDecals(palette);
	const pathStamps = await genPathStamps(palette);
	const props = await genProps(palette);
	const castleKeep = await genCastleKeep(palette);
	await writeRawRgbaPng(
		buildSparkTexture(),
		path.join(placeholdersDir, "fx_spark.png"),
	);
	await genMockScene(
		biomes.softFramesByBiome.meadow ?? [],
		decals.softFrames,
		pathStamps.softFrames,
		props.softFramesByName,
	);

	const tileIndex = {
		tileSize: 32,
		variantCount: TILE_VARIANT_COUNT,
		scheme: "16-tile blob-lite (4-directional N/E/S/W neighbor mask)",
		note: "frame variantCount+15 (mask=all-neighbors-inside) exists in every sheet for uniform indexing but is never selected at runtime — a fully interior tile uses a base variant instead (see packages/engine/src/render/groundTiles.ts#tileFrameFor).",
		biomes: biomes.index,
		decals: decals.index,
		pathStamps: pathStamps.index,
		props: props.index,
		castleKeep: castleKeep.index,
		mockScene: "mock-scene.png",
	};
	await writeFile(
		path.join(worldArtDir, "tile-index.json"),
		`${JSON.stringify(tileIndex, null, "\t")}\n`,
	);

	const decalCount = (decals.index.frames as unknown[]).length;
	const pathStampCount = (pathStamps.index.frames as unknown[]).length;
	const propCount = (props.index.props as unknown[]).length;
	console.log(
		`World art generated: ${Object.keys(biomes.index).length} biome tilesheets, ${decalCount} decals, ${pathStampCount} path stamps, ${propCount} props.`,
	);
	console.log(`Wrote ${path.join(worldArtDir, "tile-index.json")}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
