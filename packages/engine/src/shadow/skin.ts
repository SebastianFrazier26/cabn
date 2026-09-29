import { DAY_GLOW_PARAMS, NIGHT_GLOW_PARAMS } from "../fx/glowParams.js";
import type { WorldSkin } from "../systems/worldLayer.js";
import { CRIMSON_TOKENS } from "./tokens.js";

/**
 * The shadow realm's M2 skin: tints only, over the normal world art. The
 * nether art (ember sky, obsidian and netherrack ground, lava paths, rune
 * arches, ash) replaces these in M3 through the same WorldSkin hooks.
 */
export const SHADOW_SKIN: WorldSkin = {
	id: "shadow",
	grade: { day: 0xf2b4a4, night: 0x5a1a14 },
	wash: { color: 0x3a0a08, dayAlpha: 0.14, nightAlpha: 0.34 },
	skylineTint: 0xd8705c,
	groundTint: 0xd08a78,
	pathTint: 0xe09a84,
	lightColor: 0xff6a2a,
	archTint: 0xe8604c,
	particles: {
		firefly: 0xff8a3c,
		mote: 0xc8a298,
		embers: [0xff6a2a, 0xff3a1a],
		smoke: 0x7a6a68,
		dust: 0x9a5a48,
	},
	glow: {
		day: { ...DAY_GLOW_PARAMS, threshold: 0.8, bloomIntensity: 0.3 },
		night: { ...NIGHT_GLOW_PARAMS, vignetteStrength: 0.46 },
	},
	parchmentTint: 0xf0c4b4,
	uiTokens: CRIMSON_TOKENS,
	transitionColor: 0x5a1a14,
};
