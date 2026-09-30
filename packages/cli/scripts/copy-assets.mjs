#!/usr/bin/env node
// Runs after `tsc` as part of `pnpm -F @cabn/cli build` (see package.json).
// A published `@cabn/cli` has no monorepo `assets/generated/` beside it
// (see src/serve/server.ts's REPO_ASSETS_DIR doc) — this bundles the exact,
// fixed set of sprites `cabn serve` actually references into dist/assets so
// `npx @cabn/cli serve` renders real art instead of PreloadScene's tinted
// fallbacks outside this checkout. Listed explicitly, not the whole 20MB
// assets/generated/ tree, since most of it (recovered/, soften-calibration/,
// the crisp non-"_soft" and "@8x" originals) is never fetched at runtime —
// packages/engine/src/assetPaths.ts is the definitive list of paths a running
// game ever requests, and tests/serve/bundled-assets.test.ts walks its
// exports to fail the build if this list falls behind.
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoAssetsDir = join(here, "..", "..", "..", "assets", "generated");
const outDir = join(here, "..", "dist", "assets");

export const ORIGINALS = [
	"cabin_256.webp",
	"cabinet_256.webp",
	"key_256.webp",
	"letter_opener_256.webp",
	"file_256.webp",
];

export const PLACEHOLDERS = [
	"character_idle_soft.png",
	"character_idle_back_soft.png",
	"portal_arch_soft.png",
	"portal_arch_strip_soft.png",
	"ghost_soft.png",
	"wizard_tower_soft.png",
	"bonfire_frame0_soft.png",
	"bonfire_frame1_soft.png",
	"bonfire_frame2_soft.png",
	"bonfire_frame3_soft.png",
	"rot_sprite_idle0_soft.png",
	"rot_sprite_idle1_soft.png",
	"warded_mimic_idle0_soft.png",
	"warded_mimic_idle1_soft.png",
	"gremlin_idle0_soft.png",
	"gremlin_idle1_soft.png",
	"ouroboros_idle0_soft.png",
	"ouroboros_idle1_soft.png",
	"will_o_wisp_idle0_soft.png",
	"will_o_wisp_idle1_soft.png",
	"npc_guide_strip_soft.png",
	"npc_guide_bubble_soft.png",
	"npc_guide_portrait_soft.png",
	"prop_seyn_sign_soft.png",
	"ui_icon_sign_soft.png",
	"ui_icon_owner_soft.png",
	"imp_idle0_soft.png",
	"imp_idle1_soft.png",
	"magpie_idle0_soft.png",
	"magpie_idle1_soft.png",
	"skeleton_idle0_soft.png",
	"skeleton_idle1_soft.png",
	"bramble_idle0_soft.png",
	"bramble_idle1_soft.png",
	"shade_idle0_soft.png",
	"shade_idle1_soft.png",
	// AI pets (assetPaths.ts petStripPath/petPortraitPath, pets/providers.ts species).
	...["cat", "ferret", "bird", "llama", "owl", "whale"].flatMap((species) => [
		`pet_${species}_strip_soft.png`,
		`pet_${species}_portrait_soft.png`,
	]),
	// Battle frames (assetPaths.ts BATTLE_FX_MONSTER_SPECIES): hit + 3 defeat.
	...[
		"ghost",
		"rot_sprite",
		"warded_mimic",
		"gremlin",
		"ouroboros",
		"will_o_wisp",
		"imp",
		"magpie",
		"skeleton",
		"bramble",
		"shade",
	].flatMap((slug) => [
		`${slug}_hit_soft.png`,
		`${slug}_defeat0_soft.png`,
		`${slug}_defeat1_soft.png`,
		`${slug}_defeat2_soft.png`,
	]),
	"portal_arch_variants_soft.png",
	// World art (assetPaths.ts WORLD_ART_BIOMES, DECAL_SHEET_PATH,
	// PATH_STAMP_COUNT, PROP_NAMES, CASTLE_KEEP/WORLD_FOUNTAIN/SHELF_CABIN).
	...["meadow", "grove", "glade"].map((biome) => `${biome}_tiles_soft.png`),
	"decals_soft.png",
	...[0, 1, 2].map((i) => `path_stamp_${i}_soft.png`),
	...[
		"fence",
		"hedge",
		"lamp_post",
		"tree_small",
		"tree_large",
		"bush",
		"well",
		"signpost",
		"flower_pot",
		"stone_wall",
		"cottage",
		"flower_bed",
		"bench",
		"castle_keep",
		"world_fountain_strip",
		"world_fountain_gem",
		"shelf_cabin",
	].map((name) => `prop_${name}_soft.png`),
	"fx_spark.png",
	// React UI art (assetPaths.ts UI_ICON_NAMES, UI_TOOL_ICON_NAMES,
	// UI_SCREEN_NAMES, UI_SPARKLE_COLORS) — ToolHotbar, SpellbookToolbar, the
	// tool screens; ui_icon_sign is listed above with the signpost.
	...["spyglass", "orb", "bag", "quill", "wand", "key"].map(
		(name) => `ui_icon_${name}_soft.png`,
	),
	...[
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
	].map((name) => `ui_tool_${name}_soft.png`),
	...["orb", "spyglass", "satchel", "satchel_flap"].map(
		(name) => `ui_screen_${name}_soft.png`,
	),
	...["cyan", "gold", "violet"].map((color) => `ui_sparkle_${color}@8x.png`),
	// Atmosphere (assetPaths.ts atmosphereAssetEntries).
	...[
		"pine",
		"oak",
		"blossom_oak",
		"shrub",
		"rock_small",
		"boulder",
		"berry_shrub",
		"flower_patch",
		"reeds",
		"mushroom",
		"fallen_log",
		"stump",
		"ruin",
		"windmill",
		"windmill_sails",
		"pond",
		"waymarker",
	].map((name) => `scenery_${name}_soft.png`),
	...["castle", "watchtower", "village", "hill", "treeline"].flatMap(
		(piece) => [
			`skyline_${piece}_day_soft.png`,
			`skyline_${piece}_night_soft.png`,
		],
	),
	"sky_day.png",
	"sky_night.png",
	"sky_moon_soft.png",
	"sky_star_soft.png",
	"path_edge_disc_soft.png",
	"path_bed_disc_soft.png",
	...[0, 1, 2, 3].map((i) => `path_cobble_${i}_soft.png`),
];

// The shadow realm's art (engine src/shadow/assets.ts), served by `cabn
// serve` only with --owner. tests/serve/bundled-assets.test.ts walks
// shadow/skin.ts so a skin texture missing here fails the build.
export const SHADOW = [
	"ui_icon_sudo_soft.png",
	"netherrack_tiles_soft.png",
	"obsidian_tiles_soft.png",
	"nether_decals_soft.png",
	"sky_ember.png",
	"path_lava_edge_disc_soft.png",
	"path_lava_bed_disc_soft.png",
	...[0, 1, 2, 3].map((i) => `path_basalt_${i}_soft.png`),
	"portal_arch_nether_strip_soft.png",
	"portal_arch_rune_overlay_soft.png",
	"prop_nether_brazier_strip_soft.png",
	"scenery_basalt_pillar_soft.png",
	"scenery_magma_rock_soft.png",
	"scenery_lava_pond_soft.png",
	"fx_ash.png",
	"fx_ember.png",
	"parchment_scorched.png",
	...[
		"fence",
		"hedge",
		"lamp_post",
		"tree_small",
		"tree_large",
		"bush",
		"well",
		"signpost",
		"flower_pot",
		"stone_wall",
		"cottage",
		"flower_bed",
		"bench",
	].map((p) => `prop_${p}_nether_soft.png`),
	...[
		"oak",
		"blossom_oak",
		"shrub",
		"berry_shrub",
		"rock_small",
		"flower_patch",
		"reeds",
		"mushroom",
		"fallen_log",
		"stump",
		"ruin",
		"windmill",
		"windmill_sails",
		"waymarker",
	].map((s) => `scenery_${s}_nether_soft.png`),
	...["castle", "watchtower", "village", "hill", "treeline"].map(
		(s) => `skyline_${s}_nether_soft.png`,
	),
	...[
		"rot_sprite",
		"warded_mimic",
		"gremlin",
		"ouroboros",
		"will_o_wisp",
		"imp",
		"magpie",
		"skeleton",
		"bramble",
		"shade",
	].flatMap((m) => [
		`${m}_idle0_nether_soft.png`,
		`${m}_idle1_nether_soft.png`,
	]),
	"ghost_nether_soft.png",
	...[
		"rot_sprite",
		"warded_mimic",
		"gremlin",
		"ouroboros",
		"will_o_wisp",
		"imp",
		"magpie",
		"skeleton",
		"bramble",
		"shade",
		"ghost",
	].flatMap((m) => [
		`${m}_hit_nether_soft.png`,
		...[0, 1, 2].map((i) => `${m}_defeat${i}_nether_soft.png`),
	]),
	...["replace", "goto"].map((t) => `ui_tool_${t}_nether_soft.png`),
	...["orb", "spyglass", "bag", "quill", "wand", "key", "sign", "owner"].map(
		(i) => `ui_icon_${i}_nether_soft.png`,
	),
];

async function copyInto(subdir, files) {
	const srcDir = join(repoAssetsDir, subdir);
	const destDir = join(outDir, subdir);
	await mkdir(destDir, { recursive: true });
	for (const file of files) {
		try {
			await cp(join(srcDir, file), join(destDir, file));
		} catch (err) {
			// wizard_tower/bonfire/character_idle_back are on a parallel art
			// branch per assetPaths.ts's OPTIONAL_ASSET_KEYS doc — if this build
			// runs before that art has merged, skip rather than fail the build;
			// PreloadScene already has a tinted-fallback path for exactly this.
			console.warn(`cabn cli: skipping missing sprite ${file} (${err.code})`);
		}
	}
}

async function main() {
	await copyInto("originals", ORIGINALS);
	await copyInto("placeholders", PLACEHOLDERS);
	await copyInto("shadow", SHADOW);
	console.log(
		`cabn cli: bundled ${ORIGINALS.length + PLACEHOLDERS.length + SHADOW.length} sprites -> ${outDir}`,
	);
}

// Guarded so a test can import ORIGINALS/PLACEHOLDERS without copying files
// as a side effect (same pattern as apps/demo/scripts/build-world.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
