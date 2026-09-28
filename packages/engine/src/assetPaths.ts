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

// WorldScene's in-world directory marker (2026-09-28 playtest round 2
// replaced the procedural curio cabinet with an animated stone fountain —
// tools/asset-pipeline's world-art/world-fountain.ts). A horizontal strip of
// frames drawn unscaled (props' 2 screen px per cell), plus a gem overlay the
// scene tints with the world theme. Part of the worldArt bundle: without it
// WorldScene falls back to the photographic ASSET_KEYS.cabinet.
export const WORLD_FOUNTAIN_KEY = "world-fountain";
export const WORLD_FOUNTAIN_PATH = `${ASSET_BASE}/placeholders/prop_world_fountain_strip_soft.png`;
export const WORLD_FOUNTAIN_FRAME_WIDTH = 112;
export const WORLD_FOUNTAIN_FRAME_HEIGHT = 116;
export const WORLD_FOUNTAIN_FRAME_COUNT = 6;
export const WORLD_FOUNTAIN_IDLE_ANIM = "world-fountain-idle";
export const WORLD_FOUNTAIN_GEM_KEY = "world-fountain-gem";
export const WORLD_FOUNTAIN_GEM_PATH = `${ASSET_BASE}/placeholders/prop_world_fountain_gem_soft.png`;

// M10 art-consistency pass: replaces ASSET_KEYS.cabin (the photographic
// cabin_256.webp) for ShelfScene's per-world cabins — see
// tools/asset-pipeline's world-art/shelf-cabin.ts. Optional, same fallback
// shape as WORLD_FOUNTAIN_KEY: ShelfScene keeps the old cabin if this fails.
export const SHELF_CABIN_KEY = "shelf-cabin";
export const SHELF_CABIN_PATH = `${ASSET_BASE}/placeholders/prop_shelf_cabin_soft.png`;

// The guide NPC (tools/asset-pipeline's pixelmaps/guide-npc.ts): three idle
// frames on the player's own 24x32 grid at soften's cellSize 16, so she's
// drawn at the player's 0.125 scale and stands exactly as tall. The bubble is
// the same density; the portrait is a React <img> in the dialogue box, not a
// Phaser texture. Optional: without the strip WorldScene draws a tinted
// player sprite in her place.
export const GUIDE_NPC_KEY = "npc-guide";
export const GUIDE_NPC_PATH = `${ASSET_BASE}/placeholders/npc_guide_strip_soft.png`;
export const GUIDE_NPC_FRAME_WIDTH = 384;
export const GUIDE_NPC_FRAME_HEIGHT = 512;
export const GUIDE_NPC_SCALE = 0.125;
export const GUIDE_NPC_IDLE_ANIM = "npc-guide-idle";
export const GUIDE_NPC_BUBBLE_KEY = "npc-guide-bubble";
export const GUIDE_NPC_BUBBLE_PATH = `${ASSET_BASE}/placeholders/npc_guide_bubble_soft.png`;
export const GUIDE_NPC_PORTRAIT_PATH = `${ASSET_BASE}/placeholders/npc_guide_portrait_soft.png`;

// The one shared sprite behind every ambient particle effect (fireflies,
// motes, embers, smoke — see render/effects.ts) — a smooth radial-gradient
// dot, not pixel art, so it isn't run through soften() the way everything
// else in placeholders/ is.
export const FX_SPARK_KEY = "fx-spark";
export const FX_SPARK_PATH = `${ASSET_BASE}/placeholders/fx_spark.png`;

// M10a: the hand-drawn item icons (plus the opener's key, redrawn in the
// same style by the M10 art-consistency pass) and three sparkle particles from the
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
	"key",
] as const;
export type UiIconName = (typeof UI_ICON_NAMES)[number];

export function uiIconPath(name: UiIconName): string {
	return `${ASSET_BASE}/placeholders/ui_icon_${name}_soft.png`;
}

// Spellbook toolbar icons (2026-09-28) — tools/asset-pipeline's
// ui-tool-icons.ts, same soft-rendered family and placeholders/ location as
// the hotbar item icons above.
export const UI_TOOL_ICON_NAMES = [
	"find",
	"replace",
	"rename",
	"format",
	"comment",
	"goto",
	"symbol",
	"fold",
	"unfold",
	"save",
] as const;
export type UiToolIconName = (typeof UI_TOOL_ICON_NAMES)[number];

export function uiToolIconPath(name: UiToolIconName): string {
	return `${ASSET_BASE}/placeholders/ui_tool_${name}_soft.png`;
}

// Art-density pass (2026-09-28): pixel-art frames for the literal tool
// screens (crystal ball, spyglass lens, open satchel + its flap) from
// tools/asset-pipeline's ui-screen-*.ts — plain <img>/CSS assets like the
// icons above, laid out 1:1 at 3 CSS px per art cell.
export const UI_SCREEN_NAMES = [
	"orb",
	"spyglass",
	"satchel",
	"satchel_flap",
] as const;
export type UiScreenName = (typeof UI_SCREEN_NAMES)[number];

export function uiScreenPath(name: UiScreenName): string {
	return `${ASSET_BASE}/placeholders/ui_screen_${name}_soft.png`;
}

export const UI_SPARKLE_COLORS = ["cyan", "gold", "violet"] as const;
export type UiSparkleColor = (typeof UI_SPARKLE_COLORS)[number];

export function uiSparklePath(color: UiSparkleColor): string {
	return `${ASSET_BASE}/placeholders/ui_sparkle_${color}@8x.png`;
}

// M10 atmosphere pass (2026-09-28) — edge scenery, horizon skyline, night sky
// ornaments and the path-ribbon pieces, all from gen-world-art.ts (see
// world-art/scenery.ts). Optional as a group, same graceful-fallback shape as
// worldArt: missing any one skips edge scenery/skyline and keeps the old
// strip-stamp paths (PreloadScene's `atmosphereArt`).
export const SCENERY_NAMES = [
	"pine",
	"oak",
	"blossom-oak",
	"shrub",
	"rock-small",
	"boulder",
	"berry-shrub",
	"flower-patch",
	"reeds",
	"mushroom",
	"fallen-log",
	"stump",
	"ruin",
	"windmill",
	"windmill-sails",
	"pond",
	"waymarker",
] as const;
export type SceneryName = (typeof SCENERY_NAMES)[number];

export function sceneryKey(name: SceneryName): string {
	return `scenery-${name}`;
}
export function sceneryPath(name: SceneryName): string {
	return `${ASSET_BASE}/placeholders/scenery_${name.replace(/-/g, "_")}_soft.png`;
}

export const SKYLINE_PIECES = [
	"castle",
	"watchtower",
	"village",
	"hill",
	"treeline",
] as const;
export type SkylinePiece = (typeof SKYLINE_PIECES)[number];
export type SkyVariant = "day" | "night";

export function skylineKey(piece: SkylinePiece, variant: SkyVariant): string {
	return `skyline-${piece}-${variant}`;
}
export function skylinePath(piece: SkylinePiece, variant: SkyVariant): string {
	return `${ASSET_BASE}/placeholders/skyline_${piece}_${variant}_soft.png`;
}

export const SKY_DAY_KEY = "sky-day";
export const SKY_DAY_PATH = `${ASSET_BASE}/placeholders/sky_day.png`;
export const SKY_NIGHT_KEY = "sky-night";
export const SKY_NIGHT_PATH = `${ASSET_BASE}/placeholders/sky_night.png`;
export const SKY_MOON_KEY = "sky-moon";
export const SKY_MOON_PATH = `${ASSET_BASE}/placeholders/sky_moon_soft.png`;
export const SKY_STAR_KEY = "sky-star";
export const SKY_STAR_PATH = `${ASSET_BASE}/placeholders/sky_star_soft.png`;

export const PATH_EDGE_DISC_KEY = "path-edge-disc";
export const PATH_EDGE_DISC_PATH = `${ASSET_BASE}/placeholders/path_edge_disc_soft.png`;
export const PATH_BED_DISC_KEY = "path-bed-disc";
export const PATH_BED_DISC_PATH = `${ASSET_BASE}/placeholders/path_bed_disc_soft.png`;
export const PATH_COBBLE_COUNT = 4;
export function pathCobbleKey(index: number): string {
	return `path-cobble-${index}`;
}
export function pathCobblePath(index: number): string {
	return `${ASSET_BASE}/placeholders/path_cobble_${index}_soft.png`;
}

/** Every key the atmosphere pass needs, as [key, path] pairs — PreloadScene loads these and derives `atmosphereArt` from them in one place. */
export function atmosphereAssetEntries(): [string, string][] {
	return [
		...SCENERY_NAMES.map((n): [string, string] => [
			sceneryKey(n),
			sceneryPath(n),
		]),
		...SKYLINE_PIECES.flatMap((p): [string, string][] => [
			[skylineKey(p, "day"), skylinePath(p, "day")],
			[skylineKey(p, "night"), skylinePath(p, "night")],
		]),
		[SKY_DAY_KEY, SKY_DAY_PATH],
		[SKY_NIGHT_KEY, SKY_NIGHT_PATH],
		[SKY_MOON_KEY, SKY_MOON_PATH],
		[SKY_STAR_KEY, SKY_STAR_PATH],
		[PATH_EDGE_DISC_KEY, PATH_EDGE_DISC_PATH],
		[PATH_BED_DISC_KEY, PATH_BED_DISC_PATH],
		...Array.from({ length: PATH_COBBLE_COUNT }, (_, i): [string, string] => [
			pathCobbleKey(i),
			pathCobblePath(i),
		]),
	];
}
