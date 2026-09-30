import {
	BATTLE_FX_MONSTER_SPECIES,
	MONSTER_DEFEAT_FRAME_COUNT,
	type PropName,
	type SkylinePiece,
	type UiIconName,
	type UiToolIconName,
	uiIconPath,
	uiToolIconPath,
} from "../assetPaths.js";
import type {
	SkinImage,
	SkinMonster,
	SkinSheet,
	SkinStrip,
} from "../systems/worldLayer.js";

/**
 * The shadow realm's art (tools/asset-pipeline's shadow-art.ts). `cabn
 * serve` answers `/assets/shadow/*` only with `--owner`; the demo never
 * copies the folder, and none of these paths appear in assetPaths.ts.
 */
const SHADOW_ASSET_BASE = "/assets/shadow";

const image = (name: string, file: string): SkinImage => ({
	key: `shadow-${name}`,
	path: `${SHADOW_ASSET_BASE}/${file}`,
});

const sheet = (
	name: string,
	file: string,
	frameWidth: number,
	frameHeight: number,
	frames: number,
): SkinSheet => ({ ...image(name, file), frameWidth, frameHeight, frames });

const strip = (
	name: string,
	file: string,
	frameWidth: number,
	frameHeight: number,
	frames: number,
	frameRate: number,
): SkinStrip => ({
	...sheet(name, file, frameWidth, frameHeight, frames),
	frameRate,
});

/** The sudo item's icon (ui_icon_* framing), for the owner toolkit's tool definition. */
export const SUDO_ICON_PATH = `${SHADOW_ASSET_BASE}/ui_icon_sudo_soft.png`;

export const SHADOW_TEXTURES = {
	netherrack: sheet(
		"netherrack-tiles",
		"netherrack_tiles_soft.png",
		32,
		32,
		20,
	),
	obsidian: sheet("obsidian-tiles", "obsidian_tiles_soft.png", 32, 32, 20),
	decals: sheet("nether-decals", "nether_decals_soft.png", 24, 24, 6),
	lavaEdge: image("path-lava-edge", "path_lava_edge_disc_soft.png"),
	lavaBed: image("path-lava-bed", "path_lava_bed_disc_soft.png"),
	basalt: [0, 1, 2, 3].map((i) =>
		image(`path-basalt-${i}`, `path_basalt_${i}_soft.png`),
	),
	sky: image("sky-ember", "sky_ember.png"),
	// Same frame size, count and rate as the base arch (PreloadScene's
	// PORTAL_IDLE_ANIM: 6 frames at 8 fps), so arch previews line up.
	arch: strip(
		"portal-arch",
		"portal_arch_nether_strip_soft.png",
		256,
		256,
		6,
		8,
	),
	runes: strip(
		"arch-runes",
		"portal_arch_rune_overlay_soft.png",
		256,
		256,
		2,
		2,
	),
	// The world fountain's strip layout and rate.
	brazier: strip(
		"brazier",
		"prop_nether_brazier_strip_soft.png",
		112,
		116,
		6,
		8,
	),
	basaltPillar: image("basalt-pillar", "scenery_basalt_pillar_soft.png"),
	magmaRock: image("magma-rock", "scenery_magma_rock_soft.png"),
	lavaPond: image("lava-pond", "scenery_lava_pond_soft.png"),
	ash: sheet("ash", "fx_ash.png", 8, 8, 3),
	ember: image("ember", "fx_ember.png"),
	parchment: image("parchment", "parchment_scorched.png"),
} as const;

const slug = (name: string) => name.replace(/-/g, "_");

/** A normal prop redrawn for the nether (shadow-art.ts genVariants, same size as the original). */
export const netherProp = (name: PropName): SkinImage =>
	image(`prop-${name}`, `prop_${slug(name)}_nether_soft.png`);

export const netherScenery = (name: string): SkinImage =>
	image(`scenery-${name}`, `scenery_${slug(name)}_nether_soft.png`);

export const netherSkyline = (piece: SkylinePiece): SkinImage =>
	image(`skyline-${piece}`, `skyline_${piece}_nether_soft.png`);

/** Every species, as the nether shows it (shadow/monsters.ts in the asset pipeline); ghost is the one static species. */
export const NETHER_MONSTERS: Record<string, SkinMonster> = Object.fromEntries(
	BATTLE_FX_MONSTER_SPECIES.map((species) => {
		const file = slug(species);
		return [
			species,
			{
				idle:
					species === "ghost"
						? [image("monster-ghost", "ghost_nether_soft.png")]
						: [0, 1].map((i) =>
								image(
									`monster-${species}-${i}`,
									`${file}_idle${i}_nether_soft.png`,
								),
							),
				hit: image(`monster-${species}-hit`, `${file}_hit_nether_soft.png`),
				defeat: Array.from({ length: MONSTER_DEFEAT_FRAME_COUNT }, (_, i) =>
					image(
						`monster-${species}-defeat${i}`,
						`${file}_defeat${i}_nether_soft.png`,
					),
				),
			},
		];
	}),
);

/** HUD icons drawn with green, and their ember variants (shadow/icons.ts). */
const CRIMSON_TOOL_ICONS: readonly UiToolIconName[] = ["replace", "goto"];
const CRIMSON_ITEM_ICONS: readonly UiIconName[] = [
	"orb",
	"spyglass",
	"bag",
	"quill",
	"wand",
	"key",
	"sign",
	"owner",
];

export const CRIMSON_UI_ICONS: Readonly<Record<string, string>> = {
	...Object.fromEntries(
		CRIMSON_TOOL_ICONS.map((name) => [
			uiToolIconPath(name),
			`${SHADOW_ASSET_BASE}/ui_tool_${name}_nether_soft.png`,
		]),
	),
	...Object.fromEntries(
		CRIMSON_ITEM_ICONS.map((name) => [
			uiIconPath(name),
			`${SHADOW_ASSET_BASE}/ui_icon_${name}_nether_soft.png`,
		]),
	),
};
