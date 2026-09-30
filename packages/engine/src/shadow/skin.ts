import { DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS } from "../fx/glowParams.js";
import type { WorldSkin } from "../systems/worldLayer.js";
import { SHADOW_TEXTURES as T } from "./assets.js";
import { CRIMSON_TOKENS } from "./tokens.js";

/**
 * The nether: ember sky, netherrack field, obsidian clearings, lava paths
 * with a night glow, blackstone arches with pulsing red runes, braziers,
 * charred scenery and drifting ash. The grade is lighter than M2's tint-only
 * skin because the art now carries the colour itself; the grade only
 * warms it and sinks the night.
 */
export const NETHER_SKIN: WorldSkin = {
	id: "shadow",
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
		oak: T.deadTree,
		"blossom-oak": T.deadTree,
		boulder: T.magmaRock,
		pond: T.lavaPond,
	},
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
