import { PROP_NAMES, SKYLINE_PIECES } from "../assetPaths.js";
import { DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS } from "../fx/glowParams.js";
import type { WorldSkin } from "../systems/worldLayer.js";
import {
	CRIMSON_UI_ICONS,
	NETHER_MONSTERS,
	netherProp,
	netherScenery,
	netherSkyline,
	SHADOW_TEXTURES as T,
} from "./assets.js";
import { CRIMSON_TOKENS } from "./tokens.js";

/** Edge scenery with a nether variant from shadow/props.ts (plants redrawn dead, the rest recoloured); the rest have their own redraws. */
export const REMAPPED_SCENERY = [
	"oak",
	"blossom-oak",
	"shrub",
	"berry-shrub",
	"rock-small",
	"flower-patch",
	"reeds",
	"mushroom",
	"fallen-log",
	"stump",
	"ruin",
	"windmill",
	"windmill-sails",
	"waymarker",
] as const;

/**
 * The nether: ember sky, netherrack field, obsidian clearings, lava paths,
 * blackstone arches with pulsing red runes, braziers, charred scenery and
 * drifting ash. It has no day and night (2026-09-29): the realm always
 * shows its day look whatever the player's setting, with the lava and
 * braziers kept glowing through that day. Every prop, scenery piece and
 * skyline piece has a nether variant, so nothing is left to the multiply
 * tint, which turned the green art olive; the monsters wear nether art too,
 * and the HUD icons lose their green.
 */
export const NETHER_SKIN: WorldSkin = {
	id: "shadow",
	fixedTimeOfDay: "day",
	dayGlowStrength: 0.5,
	grade: { day: 0xffe0d4, night: 0x7a3028 },
	wash: { color: 0x3a0a08, dayAlpha: 0.06, nightAlpha: 0.28 },
	skylineTint: 0xc8604c,
	groundTint: null,
	pathTint: null,
	lightColor: 0xff6a2a,
	archTint: 0xff8a5a,
	particles: {
		firefly: 0xff8a3c,
		mote: 0xc8a298,
		embers: [0xff6a2a, 0xff3a1a, 0xffb347],
		smoke: 0x6a5a58,
		dust: 0x9a4a38,
	},
	glow: {
		day: { ...DAY_GLOW_PARAMS, threshold: 0.78, bloomIntensity: 0.34 },
		night: { ...NIGHT_GLOW_PARAMS, vignetteStrength: 0.46 },
	},
	parchmentTint: 0xf0c4b4,
	backdrop: 0x2a0e0c,
	uiTokens: CRIMSON_TOKENS,
	transitionColor: 0x5a1a14,
	fieldTiles: T.netherrack,
	clearingTiles: T.obsidian,
	decals: T.decals,
	// Sparse crust plates, so the molten bed shows between them.
	pathTextures: {
		edge: T.lavaEdge,
		bed: T.lavaBed,
		cobbles: T.basalt,
		cobbleFraction: 0.3,
	},
	sky: T.sky,
	arch: { strip: T.arch, overlay: T.runes },
	brazier: T.brazier,
	scenery: {
		pine: T.basaltPillar,
		boulder: T.magmaRock,
		pond: T.lavaPond,
		...Object.fromEntries(REMAPPED_SCENERY.map((k) => [k, netherScenery(k)])),
	},
	props: Object.fromEntries(PROP_NAMES.map((name) => [name, netherProp(name)])),
	skyline: Object.fromEntries(
		SKYLINE_PIECES.map((piece) => [piece, netherSkyline(piece)]),
	),
	monsters: NETHER_MONSTERS,
	// A dead mill: its torn sails hang still.
	stillScenery: ["windmill-sails"],
	uiIcons: CRIMSON_UI_ICONS,
	scatterTint: 0x7a4a44,
	ambient: {
		ash: { texture: T.ash, tint: 0xd8ccc8, frequencyMs: 140, alpha: 0.7 },
		embers: {
			texture: T.ember,
			colors: [0xff6a2a, 0xffb347, 0xff3a1a],
			frequencyMs: 280,
		},
	},
	pathGlow: {
		spacingPx: 110,
		radiusPx: 58,
		color: 0xff5a1a,
		alpha: 0.8,
		flicker: true,
		maxPools: 220,
	},
	parchment: T.parchment,
};

/** M2's name for the realm's skin, kept so existing imports still resolve. */
export const SHADOW_SKIN = NETHER_SKIN;
