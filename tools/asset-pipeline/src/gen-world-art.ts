import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RGB } from "./color.js";
import {
	composeSheet,
	compositeInto,
	type RawImage,
	upscaleNearest,
	writeRawRgbaPng,
} from "./image-io.js";
import { writeJsonFile } from "./json-io.js";
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
	PROP_CELL_SIZE,
	type PropPaletteIndices,
} from "./world-art/props.js";
import {
	buildMoon,
	buildPathRibbon,
	buildScenery,
	buildSkyline,
	buildStar,
	FINE_CELL_SIZE,
} from "./world-art/scenery.js";
import {
	buildShelfCabinGrid,
	type ShelfCabinPalette,
} from "./world-art/shelf-cabin.js";
import {
	buildWorldFountainFrame,
	buildWorldFountainGem,
	WORLD_FOUNTAIN_FRAME_COUNT,
	WORLD_FOUNTAIN_HEIGHT,
	WORLD_FOUNTAIN_WIDTH,
	type WorldFountainPalette,
} from "./world-art/world-fountain.js";

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
	steelGray: 28,
	paleGhostBlue: 30,
	slateBlue: 31,
	plum: 32,
	slateDark: 60,
	periwinkle: 37,
	mossShadow: 4,
	mossHighlight: 9,
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

// Ground tiles/decals/path stamps/props are meant to read as clean, flat
// Stardew-style pixel art with deliberate multi-tone shading baked into the
// grid itself (see biome-tiles.ts) — soften()'s own per-cell jitter/grain
// (tuned for the hero sprites' chunky-bevel look) added visible speckle on
// top of that, which is exactly the "Minecraft dirt" noise the user
// rejected; zeroed out here instead of just turned down. bloom stays
// dialed back since none of this art has bright highlights meant to glow.
function worldArtSoftenOptions(
	cellSize: number,
	seed: number,
	edgeFeatherPx = 1,
) {
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

async function renderSoft(
	grid: Grid,
	name: string,
	palette: RGB[],
	cellSize: number,
	seed: number,
	edgeFeatherPx?: number,
): Promise<{ crisp: RawImage; soft: RawImage }> {
	const map = toPixelMap(name, grid);
	const crisp = renderPixelMap(map, palette);
	const soft = soften(
		crisp,
		worldArtSoftenOptions(cellSize, seed, edgeFeatherPx),
	);
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
		const grids = buildBiomeTileFrames(grassTones);
		biomeSeed += 10_000;

		const crispFrames: RawImage[] = [];
		const softFrames: RawImage[] = [];
		for (const [i, grid] of grids.entries()) {
			// A heavier feather than the world-art default (1px) here
			// specifically — edge tiles are transparent outside the grass
			// silhouette now (see biome-tiles.ts), so this is the actual "soft,
			// organic edge" the batch-3 review asked for; base variants (fully
			// opaque, no silhouette to feather) are unaffected by the value.
			const { crisp, soft } = await renderSoft(
				grid,
				`${biome}_tile_${i}`,
				palette,
				2,
				20260928 + biomeSeed + i,
				2,
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
	ink: PALETTE.ink,
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
	// Same meadow tones as scenery's oaks, so scattered trees and the edge
	// forest read as one species rather than two greens.
	treeTones: {
		shadow: PALETTE.meadowShadow,
		base: PALETTE.meadowBase,
		highlight: PALETTE.meadowHighlight,
	},
	blossomAccent: PALETTE.berryPink,
	bushTones: {
		shadow: PALETTE.meadowShadow,
		base: PALETTE.meadowBase,
		highlight: PALETTE.meadowHighlight,
	},
	waterDark: PALETTE.ink,
	waterShine: PALETTE.paleGhostBlue,
	plankCream: PALETTE.parchment,
	plankShadow: PALETTE.pathBase,
	potColor: PALETTE.terracotta,
	potShadow: PALETTE.autumnOrangeDark,
	potLight: PALETTE.autumnOrange,
	dirt: PALETTE.pathShadow,
	petal: PALETTE.berryPink,
	petalAlt: PALETTE.skyBlue,
	petalCenter: PALETTE.sunYellow,
	// Cottage: plaster + timber under the shelf cabin's exact roof ramp, so
	// scattered cottages and shelf cabins read as one village; windows stay
	// bright enough to catch the night bloom threshold (see props.ts).
	plaster: PALETTE.parchment,
	plasterShadow: PALETTE.pathBase,
	roofColor: PALETTE.autumnOrange,
	roofShadow: PALETTE.autumnOrangeDark,
	roofHighlight: PALETTE.terracotta,
	windowGlow: PALETTE.lanternGlow,
	windowWarm: PALETTE.sunYellow,
	knob: PALETTE.sunYellow,
	bedSoil: PALETTE.pathShadow,
	flagColor: PALETTE.berryPink,
	turretRoof: {
		light: PALETTE.autumnOrange,
		base: PALETTE.terracotta,
		dark: PALETTE.autumnOrangeDark,
	},
};

const IVY_TONES = {
	shadow: PALETTE.groveShadow,
	base: PALETTE.groveBase,
	highlight: PALETTE.groveHighlight,
} as const;

// Landmarks (the shelf cabin) render at the wizard tower's
// cellSize (16) — the engine displays them at the tower's own scale, so this
// is what makes their on-screen pixel size match the tower's (see engine
// render/scale.ts). Props and scenery reach the same density a different
// way: fine grids at cellSize 2, drawn unscaled.
const LANDMARK_CELL_SIZE = 16;
const LANDMARK_EDGE_FEATHER_PX = 2;

// Exactly the portal arch's stone/moss/rune indices (pixelmaps/portal-arch.ts
// PORTAL_LEGEND), so the fountain and the arches around it read as one set.
const WORLD_FOUNTAIN_PALETTE: WorldFountainPalette = {
	ink: PALETTE.ink,
	stoneLight: PALETTE.stoneLight,
	stone: PALETTE.steelGray,
	stoneShadow: PALETTE.slateBlue,
	mossShadow: PALETTE.mossShadow,
	mossLight: PALETTE.mossHighlight,
	rune: PALETTE.paleGhostBlue,
	water: PALETTE.skyBlue,
	waterDeep: PALETTE.periwinkle,
	waterLight: PALETTE.paleGhostBlue,
	sparkle: PALETTE.cream,
	gemLight: PALETTE.cream,
	gemMid: PALETTE.stoneLight,
	gemDark: PALETTE.steelGray,
};

// Roof matches the cottage prop's autumn-orange pair so the scattered
// cottages and the shelf cabins read as the same village; walls use the
// warm/dark/light wood trio every wooden prop uses.
const SHELF_CABIN_PALETTE: ShelfCabinPalette = {
	ink: PALETTE.ink,
	roofSeam: PALETTE.woodDark,
	roofShadow: PALETTE.autumnOrangeDark,
	roofBase: PALETTE.autumnOrange,
	roofHighlight: PALETTE.terracotta,
	woodDark: PALETTE.woodDark,
	wood: PALETTE.woodWarm,
	woodLight: PALETTE.woodLight,
	stoneDark: PALETTE.stoneDark,
	stone: PALETTE.stoneMid,
	stoneLight: PALETTE.stoneLight,
	windowGlow: PALETTE.lanternGlow,
	windowWarm: PALETTE.sunYellow,
	knob: PALETTE.sunYellow,
	pot: PALETTE.terracotta,
	potShadow: PALETTE.autumnOrangeDark,
	petalA: PALETTE.berryPink,
	petalB: PALETTE.sunYellow,
	petalC: PALETTE.cream,
	ivy: IVY_TONES,
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

async function genLandmark(
	grid: Grid,
	slug: string,
	palette: RGB[],
	seed: number,
): Promise<void> {
	const { crisp, soft } = await renderSoft(
		grid,
		slug,
		palette,
		LANDMARK_CELL_SIZE,
		seed,
		LANDMARK_EDGE_FEATHER_PX,
	);
	await writePair(slug, crisp, soft, 8);
}

/** In-world directory marker (see world-fountain.ts's doc comment): a horizontal strip of animation frames plus a separate gem overlay the engine tints per world. */
async function genWorldFountain(
	palette: RGB[],
): Promise<Record<string, unknown>> {
	const crispFrames: RawImage[] = [];
	const softFrames: RawImage[] = [];
	for (let i = 0; i < WORLD_FOUNTAIN_FRAME_COUNT; i++) {
		// One seed for every frame so soften()'s edge treatment of the stone is
		// identical frame to frame — only the water may change, or the whole
		// fountain would shimmer.
		const { crisp, soft } = await renderSoft(
			buildWorldFountainFrame(WORLD_FOUNTAIN_PALETTE, i),
			`prop_world_fountain_f${i}`,
			palette,
			PROP_CELL_SIZE,
			20261400,
		);
		crispFrames.push(crisp);
		softFrames.push(soft);
	}
	await writePair(
		"prop_world_fountain_strip",
		composeSheet(crispFrames, WORLD_FOUNTAIN_FRAME_COUNT),
		composeSheet(softFrames, WORLD_FOUNTAIN_FRAME_COUNT),
		8,
	);
	const gem = await renderSoft(
		buildWorldFountainGem(WORLD_FOUNTAIN_PALETTE),
		"prop_world_fountain_gem",
		palette,
		PROP_CELL_SIZE,
		20261401,
	);
	await writePair("prop_world_fountain_gem", gem.crisp, gem.soft, 8);
	return {
		name: "world-fountain",
		key: "world-fountain",
		file: "placeholders/prop_world_fountain_strip_soft.png",
		frameWidth: WORLD_FOUNTAIN_WIDTH * PROP_CELL_SIZE,
		frameHeight: WORLD_FOUNTAIN_HEIGHT * PROP_CELL_SIZE,
		frames: WORLD_FOUNTAIN_FRAME_COUNT,
		gem: "placeholders/prop_world_fountain_gem_soft.png",
	};
}

/** Replaces the photographic cabin_256.webp for the shelf's per-world cabins — see shelf-cabin.ts's doc comment. */
async function genShelfCabin(palette: RGB[]): Promise<Record<string, unknown>> {
	await genLandmark(
		buildShelfCabinGrid(SHELF_CABIN_PALETTE),
		"prop_shelf_cabin",
		palette,
		20261500,
	);
	return {
		name: "shelf-cabin",
		key: "shelf-cabin",
		file: "placeholders/prop_shelf_cabin_soft.png",
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

// --- M10 atmosphere pass (2026-09-28) ----------------------------------------

const SCENERY_PALETTE = {
	pineTones: {
		shadow: PALETTE.groveShadow,
		base: PALETTE.groveBase,
		highlight: PALETTE.groveHighlight,
	},
	oakTones: {
		shadow: PALETTE.meadowShadow,
		base: PALETTE.meadowBase,
		highlight: PALETTE.meadowHighlight,
	},
	shrubTones: {
		shadow: PALETTE.meadowShadow,
		base: PALETTE.meadowBase,
		highlight: PALETTE.meadowHighlight,
	},
	trunk: PALETTE.woodDark,
	trunkDark: PALETTE.ink,
	stone: PALETTE.stoneMid,
	stoneShadow: PALETTE.stoneDark,
	stoneHighlight: PALETTE.stoneLight,
	moss: PALETTE.groveHighlight,
	berry: PALETTE.mushroomRed,
	blossom: PALETTE.berryPink,
	plank: PALETTE.parchment,
	ink: PALETTE.ink,
	petalA: PALETTE.berryPink,
	petalB: PALETTE.skyBlue,
	petalC: PALETTE.sunYellow,
	petalCenter: PALETTE.cream,
	stem: PALETTE.groveBase,
	reed: PALETTE.gladeBase,
	reedTip: PALETTE.woodWarm,
	capRed: PALETTE.mushroomRed,
	capShadow: PALETTE.autumnOrangeDark,
	capSpot: PALETTE.cream,
	stalk: PALETTE.parchment,
	water: PALETTE.skyBlue,
	waterDeep: PALETTE.periwinkle,
	waterShine: PALETTE.paleGhostBlue,
	shore: PALETTE.pathBase,
	lily: PALETTE.meadowShadow,
	wood: PALETTE.woodWarm,
	woodDark: PALETTE.woodDark,
	woodLight: PALETTE.woodLight,
	plaster: PALETTE.parchment,
	plasterShadow: PALETTE.pathBase,
	roof: PALETTE.terracotta,
	roofShadow: PALETTE.autumnOrangeDark,
	sailCloth: PALETTE.cream,
	windowGlow: PALETTE.lanternGlow,
};

async function genScenery(palette: RGB[]): Promise<Record<string, unknown>> {
	const pieces = buildScenery(SCENERY_PALETTE);
	const index: { name: string; key: string; file: string }[] = [];
	for (const [i, piece] of pieces.entries()) {
		const slug = `scenery_${piece.name.replace(/-/g, "_")}`;
		const { crisp, soft } = await renderSoft(
			piece.grid,
			slug,
			palette,
			piece.cellSize,
			20261500 + i,
		);
		await writePair(slug, crisp, soft, 8);
		index.push({
			name: piece.name,
			key: `scenery-${piece.name}`,
			file: `placeholders/${slug}_soft.png`,
		});
	}
	return { pieces: index };
}

/**
 * Multiplies every pixel by a night tint — the skyline's night variants are
 * the day art, darkened and cooled, with the window layer composited back on
 * top un-darkened. Done on the rendered image rather than by remapping palette
 * indices because palette.json has no night-blue ramp to map onto, and adding
 * one would ripple into every other consumer's hardcoded indices.
 */
function nightify(image: RawImage, tint: RGB): RawImage {
	const data = Buffer.from(image.data);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = Math.round((data[i] ?? 0) * (tint.r / 255));
		data[i + 1] = Math.round((data[i + 1] ?? 0) * (tint.g / 255));
		data[i + 2] = Math.round((data[i + 2] ?? 0) * (tint.b / 255));
	}
	return { data, width: image.width, height: image.height };
}

const SKYLINE_NIGHT_TINT: RGB = { r: 70, g: 74, b: 150 };

async function genSkyline(palette: RGB[]): Promise<Record<string, unknown>> {
	const pieces = buildSkyline({
		farStone: PALETTE.slateBlue,
		farStoneShadow: PALETTE.slateDark,
		farStoneLight: PALETTE.steelGray,
		farRoof: PALETTE.plum,
		flag: PALETTE.berryPink,
		hillTones: {
			shadow: PALETTE.gladeShadow,
			base: PALETTE.gladeBase,
			highlight: PALETTE.gladeHighlight,
		},
		treeTones: {
			shadow: PALETTE.groveShadow,
			base: PALETTE.groveBase,
			highlight: PALETTE.groveHighlight,
		},
		window: PALETTE.lanternGlow,
	});
	const index: Record<string, unknown>[] = [];
	for (const [i, piece] of pieces.entries()) {
		const slug = `skyline_${piece.name}`;
		const day = await renderSoft(
			piece.grid,
			slug,
			palette,
			piece.cellSize,
			20261600 + i,
		);
		await writePair(`${slug}_day`, day.crisp, day.soft, 4);
		const nightSoft = nightify(day.soft, SKYLINE_NIGHT_TINT);
		const nightCrisp = nightify(day.crisp, SKYLINE_NIGHT_TINT);
		if (piece.windows.some((row) => row.some((cell) => cell !== null))) {
			const lit = await renderSoft(
				piece.windows,
				`${slug}_windows`,
				palette,
				piece.cellSize,
				20261650 + i,
			);
			compositeInto(nightSoft, lit.soft, 0, 0);
			compositeInto(nightCrisp, lit.crisp, 0, 0);
		}
		await writePair(`${slug}_night`, nightCrisp, nightSoft, 4);
		index.push({
			name: piece.name,
			day: `placeholders/${slug}_day_soft.png`,
			night: `placeholders/${slug}_night_soft.png`,
		});
	}

	const ornaments = {
		moonLight: PALETTE.cream,
		moonMid: PALETTE.parchment,
		moonShadow: PALETTE.steelGray,
		star: PALETTE.paleGhostBlue,
		starCore: PALETTE.cream,
	};
	const moon = await renderSoft(
		buildMoon(ornaments),
		"sky_moon",
		palette,
		FINE_CELL_SIZE,
		20261700,
	);
	await writePair("sky_moon", moon.crisp, moon.soft, 4);
	const star = await renderSoft(
		buildStar(ornaments),
		"sky_star",
		palette,
		2,
		20261701,
		0,
	);
	await writePair("sky_star", star.crisp, star.soft, 4);

	await writeRawRgbaPng(
		buildSkyGradient({ r: 118, g: 178, b: 228 }, { r: 206, g: 230, b: 236 }),
		path.join(placeholdersDir, "sky_day.png"),
	);
	await writeRawRgbaPng(
		buildSkyGradient({ r: 10, g: 12, b: 38 }, { r: 58, g: 46, b: 104 }),
		path.join(placeholdersDir, "sky_night.png"),
	);
	return { pieces: index, moon: "placeholders/sky_moon_soft.png" };
}

const SKY_GRADIENT_HEIGHT = 128;

/** Smooth, not pixel art (same exception as buildSparkTexture): a stepped sky gradient bands visibly once stretched across the whole horizon. */
function buildSkyGradient(top: RGB, horizon: RGB): RawImage {
	const width = 4;
	const height = SKY_GRADIENT_HEIGHT;
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

async function genPathRibbon(palette: RGB[]): Promise<Record<string, unknown>> {
	const pieces = buildPathRibbon({
		edge: PALETTE.pathHighlight,
		edgeShadow: PALETTE.pathBase,
		bed: PALETTE.stoneDark,
		stone: PALETTE.stoneMid,
		stoneShadow: PALETTE.stoneDark,
		stoneHighlight: PALETTE.stoneLight,
	});
	const files: string[] = [];
	for (const [i, piece] of pieces.entries()) {
		const slug = `path_${piece.name.replace(/-/g, "_")}`;
		const { crisp, soft } = await renderSoft(
			piece.grid,
			slug,
			palette,
			piece.cellSize,
			20261800 + i,
			0,
		);
		await writePair(slug, crisp, soft, 6);
		files.push(`placeholders/${slug}_soft.png`);
	}
	return { files };
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
	const worldFountain = await genWorldFountain(palette);
	const shelfCabin = await genShelfCabin(palette);
	const scenery = await genScenery(palette);
	const skyline = await genSkyline(palette);
	const pathRibbon = await genPathRibbon(palette);
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
		worldFountain,
		shelfCabin,
		scenery,
		skyline,
		pathRibbon,
		mockScene: "mock-scene.png",
	};
	await writeJsonFile(path.join(worldArtDir, "tile-index.json"), tileIndex);

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
