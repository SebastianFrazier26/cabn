import {
	NIGHT_TOKENS,
	type PixelThemeTokens,
} from "../react/pixelThemeTokens.js";

/**
 * The shadow realm's HUD palette: NIGHT_TOKENS' dark-mode structure
 * (light text on a near-black panel) shifted to ember and crimson. Every
 * text pair is contrast-tested with the day and night sets
 * (editorThemeContrast.test.ts). The realm's one palette: it has no night
 * (its skin pins the day), and the dark ember panels are the ones that
 * read against its bright red field, so there is no day/night pair here.
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
	// Brass, not NIGHT_TOKENS' mint: the realm keeps green out entirely (the
	// soul crystals are its one cool accent), so Run/confirm/victory go warm.
	accentGreen: 0xd9b44a,
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
	// Own overrides, not inherited from the NIGHT_TOKENS spread above: these
	// accent fills (accentViolet/accentPink) are crimson's own colors, not
	// night's, so an ink computed against night's fills would be wrong here
	// (packages/engine/tests/uiContrast.test.ts checks each against the real
	// accent it actually sits on). warnInk/guideMoreInk already cleared
	// their threshold against the realm's own accentYellow/accentOrange and
	// so are left equal to them, same convention as the day/night tokens.
	accentVioletInk: 0xfcede8,
	accentPinkInk: 0xfef9f8,
	chipInk: 0xdfb0ac,
	errorInk: 0xdd4e44,
	warnInk: 0xffb347,
	guideMoreInk: 0xff6a2a,
};
