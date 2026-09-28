// Root-relative convention, independent of worldUrl: hosting apps copy
// assets/generated/{originals,placeholders} verbatim to <publicRoot>/assets/
// (see apps/demo/scripts/build-world.mjs). Keeping this separate from the
// world bundle means the same sprite set works across many converted worlds
// without duplicating sprites per-world.
const ASSET_BASE = "/assets";

export const ASSET_KEYS = {
	cabin: "cabin",
	cabinet: "cabinet",
	characterIdle: "character-idle",
	portalArchStrip: "portal-arch-strip",
} as const;

export const ASSET_PATHS = {
	[ASSET_KEYS.cabin]: `${ASSET_BASE}/originals/cabin_256.webp`,
	[ASSET_KEYS.cabinet]: `${ASSET_BASE}/originals/cabinet_256.webp`,
	[ASSET_KEYS.characterIdle]: `${ASSET_BASE}/placeholders/character_idle_soft.png`,
	[ASSET_KEYS.portalArchStrip]: `${ASSET_BASE}/placeholders/portal_arch_strip_soft.png`,
} as const;

// portal_arch_strip_soft.png is 6 frames of 256x256 laid out horizontally
// (1536x256 total) — see assets/generated/placeholders.
export const PORTAL_ARCH_FRAME_SIZE = 256;
export const PORTAL_ARCH_FRAME_COUNT = 6;

export const BONFIRE_FRAME_COUNT = 4;

// M6 monster sprites. Ghost (M2) is a single static image — no idle animation
// — so it gets its own key rather than the frame-pair shape the other five
// species use (each rendered as two idle frames by tools/asset-pipeline, see
// its pixelmaps/{rot-sprite,warded-mimic,gremlin,ouroboros,will-o-wisp}.ts).
const MONSTER_FILE_SLUG: Record<string, string> = {
	"rot-sprite": "rot_sprite",
	"warded-mimic": "warded_mimic",
	gremlin: "gremlin",
	ouroboros: "ouroboros",
	"will-o-wisp": "will_o_wisp",
};

export const MONSTER_GHOST_KEY = "monster-ghost";
export const MONSTER_GHOST_PATH = `${ASSET_BASE}/placeholders/ghost_soft.png`;

export function monsterFrameKey(species: string, frame: 0 | 1): string {
	return `monster-${species}-${frame}`;
}

export function monsterFramePath(species: string, frame: 0 | 1): string {
	const slug = MONSTER_FILE_SLUG[species] ?? species;
	return `${ASSET_BASE}/placeholders/${slug}_idle${frame}_soft.png`;
}

/** Species with a real two-frame idle animation — everything except ghost. */
export const ANIMATED_MONSTER_SPECIES = [
	"rot-sprite",
	"warded-mimic",
	"gremlin",
	"ouroboros",
	"will-o-wisp",
] as const;

function bonfireFrameKey(index: number): string {
	return `bonfire-frame-${index}`;
}

// Art for these three keys is being drawn on a parallel branch (feat/art-
// hierarchy-sprites) and may not exist in assets/generated yet. PreloadScene
// tracks per-key load failures and the world/shelf scenes fall back to an
// existing sprite (tinted cabinet for the tower, tinted portal frame0 for
// the bonfire, front sprite for the back view) so this branch runs green
// standalone and picks up the real art once both branches merge.
export const OPTIONAL_ASSET_KEYS = {
	wizardTower: "wizard-tower",
	characterIdleBack: "character-idle-back",
	bonfireFrame: bonfireFrameKey,
} as const;

export const OPTIONAL_ASSET_PATHS = {
	[OPTIONAL_ASSET_KEYS.wizardTower]: `${ASSET_BASE}/placeholders/wizard_tower_soft.png`,
	[OPTIONAL_ASSET_KEYS.characterIdleBack]: `${ASSET_BASE}/placeholders/character_idle_back_soft.png`,
	bonfireFrame: (index: number) =>
		`${ASSET_BASE}/placeholders/bonfire_frame${index}_soft.png`,
} as const;

// M10b batch 1 (world art) — see tools/asset-pipeline/src/gen-world-art.ts,
// which renders all of these, and assets/generated/world-art/tile-index.json
// for the human-readable frame index this hardcodes. Optional, same
// graceful-fallback shape as wizardTower/bonfire above: WorldScene/ShelfScene
// fall back to the old tinted-ellipse-and-dashed-line ground/paths if any
// piece is missing, rather than a half-tiled scene.
export const WORLD_ART_BIOMES = ["meadow", "grove", "glade"] as const;
export type WorldArtBiome = (typeof WORLD_ART_BIOMES)[number];

export const BIOME_TILE_FRAME_SIZE = 32;
export const BIOME_TILE_SHEET_COLS = 5;
/** Base grass-variant frames are 0..VARIANT_COUNT-1; edge frames start at VARIANT_COUNT (see groundTiles.ts#tileFrameFor). */
export const BIOME_TILE_VARIANT_COUNT = 4;

export function biomeTileSheetKey(biome: WorldArtBiome): string {
	return `biome-tiles-${biome}`;
}
export function biomeTileSheetPath(biome: WorldArtBiome): string {
	return `${ASSET_BASE}/placeholders/${biome}_tiles_soft.png`;
}

export const DECAL_SHEET_KEY = "world-decals";
export const DECAL_SHEET_PATH = `${ASSET_BASE}/placeholders/decals_soft.png`;
export const DECAL_FRAME_SIZE = 24;
export const DECAL_COUNT = 6;

export const PATH_STAMP_COUNT = 3;
export function pathStampKey(index: number): string {
	return `path-stamp-${index}`;
}
export function pathStampPath(index: number): string {
	return `${ASSET_BASE}/placeholders/path_stamp_${index}_soft.png`;
}

// M10b batch 2: "stone-lantern" -> "lamp-post" (upgraded design) and
// "log-pile" -> "stone-wall" (replaced, weaker of the batch-1 set per
// review) plus 3 new cottagecore props. Renamed rather than kept alongside
// the old names since nothing outside this pool ever names a prop directly.
export const PROP_NAMES = [
	"fence",
	"hedge",
	"lamp-post",
	"tree-small",
	"tree-large",
	"bush",
	"well",
	"signpost",
	"flower-pot",
	"stone-wall",
	"cottage",
	"flower-bed",
	"bench",
] as const;
export type PropName = (typeof PROP_NAMES)[number];

export function propKey(name: PropName): string {
	return `prop-${name}`;
}
export function propPath(name: PropName): string {
	return `${ASSET_BASE}/placeholders/prop_${name.replace(/-/g, "_")}_soft.png`;
}

// The shelf's one-off decorative keep near the tower — not part of the
// PROP_NAMES scatter pool (see props.ts's castleKeep doc comment), so it
// gets its own optional key/path pair, same shape as wizardTower/bonfire.
export const CASTLE_KEEP_KEY = "castle-keep";
export const CASTLE_KEEP_PATH = `${ASSET_BASE}/placeholders/prop_castle_keep_soft.png`;

// M10b batch 3: replaces ASSET_KEYS.cabinet (the photographic cabinet_256.webp)
// for WorldScene's in-world cluster markers only — see props.ts's
// worldCabinet doc comment. Optional/graceful-fallback like every other
// batch-2/3 asset: WorldScene keeps using ASSET_KEYS.cabinet if this fails to load.
export const WORLD_CABINET_KEY = "world-cabinet";
export const WORLD_CABINET_PATH = `${ASSET_BASE}/placeholders/prop_world_cabinet_soft.png`;

// The one shared sprite behind every ambient particle effect (fireflies,
// motes, embers, smoke — see render/effects.ts) — a smooth radial-gradient
// dot, not pixel art, so it isn't run through soften() the way everything
// else in placeholders/ is.
export const FX_SPARK_KEY = "fx-spark";
export const FX_SPARK_PATH = `${ASSET_BASE}/placeholders/fx_spark.png`;

// M10a: the five hand-drawn item icons and three sparkle particles from the
// approved UI mockup (assets/generated/ui/), copied into placeholders/ under
// their existing filenames rather than adding a fourth synced source
// directory to apps/demo/scripts/build-world.mjs — that directory also holds
// the mockup's own .html/.md files, which have no reason to reach a public
// asset folder. These are plain <img>/React assets (ToolHotbar, the
// per-tool open-burst effects), not Phaser textures.
export const UI_ICON_NAMES = [
	"spyglass",
	"orb",
	"bag",
	"quill",
	"wand",
] as const;
export type UiIconName = (typeof UI_ICON_NAMES)[number];

export function uiIconPath(name: UiIconName): string {
	return `${ASSET_BASE}/placeholders/ui_icon_${name}_soft.png`;
}

export const UI_SPARKLE_COLORS = ["cyan", "gold", "violet"] as const;
export type UiSparkleColor = (typeof UI_SPARKLE_COLORS)[number];

export function uiSparklePath(color: UiSparkleColor): string {
	return `${ASSET_BASE}/placeholders/ui_sparkle_${color}@8x.png`;
}
