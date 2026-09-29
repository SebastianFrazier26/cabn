import {
	NIGHT_TOKENS,
	type PixelThemeTokens,
} from "../react/pixelThemeTokens.js";

/**
 * The shadow realm's HUD palette: NIGHT_TOKENS' dark-mode structure
 * (light text on a near-black panel) shifted to ember and crimson. Every
 * text pair is contrast-tested with the day and night sets
 * (editorThemeContrast.test.ts). Placeholder until the M3 nether art.
 */
export const CRIMSON_TOKENS: PixelThemeTokens = {
	...NIGHT_TOKENS,
	panelBody: 0x24100e,
	panelBodyAlt: 0x1a0a09,
	borderOuter: 0x8a2a1c,
	borderHighlight: 0xff7a3c,
	text: 0xfbe9e4,
	textSecondary: 0xe0b3a8,
	accentYellow: 0xffb347,
	accentPink: 0xd8352a,
	accentOrange: 0xff6a2a,
	accentViolet: 0xb04a6a,
	syntaxKeyword: 0xff9e5c,
	syntaxString: 0xf5d27a,
	syntaxNumber: 0xffb3a1,
	syntaxFunction: 0xffc79a,
	syntaxType: 0xff9fb8,
	syntaxAttribute: 0xffe28a,
	editorGutterText: 0xd79a8c,
	diffDelBg: 0x4a1414,
	diffDelText: 0xffb3b3,
};
