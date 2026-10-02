#!/usr/bin/env node
// `pnpm -F @cabn/shadow-art build`: copies the fixed list of shadow PNGs the
// engine's shadow skin names (packages/engine/src/shadow/assets.ts) from the
// asset pipeline's output into dist/shadow. Listed explicitly, like
// packages/cli/scripts/copy-assets.mjs, because assets/generated/shadow/ also
// holds crisp originals and @8x masters no running game fetches.
// tests/shadowArt.test.ts walks shadow/skin.ts so a skin texture missing
// here fails the tests.
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "..", "..", "assets", "generated", "shadow");
const outDir = join(here, "..", "dist", "shadow");

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

async function main() {
	// Cleared first so a sprite dropped from SHADOW can't linger in a tarball.
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	// Unlike the cli's sprites, a missing file fails: this package is nothing
	// but these files, so publishing it short would be a silent regression.
	for (const file of SHADOW) await cp(join(srcDir, file), join(outDir, file));
	console.log(`cabn shadow-art: copied ${SHADOW.length} sprites -> ${outDir}`);
}

// Guarded so the test can import SHADOW without copying files.
if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
