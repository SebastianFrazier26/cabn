// Day/night color values for every `--cabn-*` CSS custom property
// pixelTheme.tsx's injected stylesheet defines — pulled out into typed
// constants (rather than left as literals inside the CSS template string)
// specifically so packages/engine/tests/editorThemeContrast.test.ts can
// assert every editor fg/bg pair against the *actual* values shipped,
// instead of a second, driftable copy of the same hexes. Everything else in
// pixelTheme.tsx (panel chrome, animations, per-component layout) stays a
// plain template string — only the token values themselves needed a shared,
// testable source of truth.
export interface PixelThemeTokens {
	panelBody: number;
	panelBodyAlt: number;
	borderOuter: number;
	borderHighlight: number;
	text: number;
	textSecondary: number;
	accentYellow: number;
	accentGreen: number;
	accentPink: number;
	accentOrange: number;
	accentCyan: number;
	accentViolet: number;
	/**
	 * Editor-only syntax-highlight colors — hand-darkened variants of the
	 * accent-* tones above (same technique as palette.ts's goldDark/
	 * amethystDark/etc.), each computed so it clears WCAG AA (4.5:1) for text
	 * against `panelBody`; see editorThemeContrast.test.ts. The raw accents
	 * are all too light on this near-white panel body to use directly.
	 */
	syntaxKeyword: number;
	syntaxString: number;
	syntaxNumber: number;
	syntaxFunction: number;
	syntaxType: number;
	syntaxAttribute: number;
	/** Same reasoning as the syntax-* colors, but against `panelBodyAlt` (the editor gutter's own background) rather than `panelBody`. */
	editorGutterText: number;
}

export const DAY_TOKENS: PixelThemeTokens = {
	panelBody: 0xf2f8ff,
	panelBodyAlt: 0xdff0ff,
	borderOuter: 0x3b2f6b,
	borderHighlight: 0x8fd6ef,
	text: 0x201a3d,
	textSecondary: 0x55507f,
	accentYellow: 0xffd23f,
	accentGreen: 0x5ec26a,
	accentPink: 0xef5fa0,
	accentOrange: 0xff9142,
	accentCyan: 0x4fd0d8,
	accentViolet: 0x8a6fd6,
	syntaxKeyword: 0xbc4f00,
	syntaxString: 0x2e8037,
	syntaxNumber: 0x7a5ad4,
	syntaxFunction: 0x1a7b81,
	syntaxType: 0xd8106a,
	syntaxAttribute: 0x8b6b00,
	editorGutterText: 0x55507f,
};

export const NIGHT_TOKENS: PixelThemeTokens = {
	panelBody: 0xeeeaff,
	panelBodyAlt: 0xded6ff,
	borderOuter: 0x221a4d,
	borderHighlight: 0xffd23f,
	text: 0x1c1640,
	textSecondary: 0x635ca8,
	accentYellow: 0xffcf4d,
	accentGreen: 0x46d19a,
	accentPink: 0xff4fa0,
	accentOrange: 0xff7a45,
	accentCyan: 0x46c9e0,
	accentViolet: 0x7a5fe0,
	syntaxKeyword: 0xc23700,
	syntaxString: 0x1b7753,
	syntaxNumber: 0x6d4fe1,
	syntaxFunction: 0x137384,
	syntaxType: 0xd10060,
	syntaxAttribute: 0x886300,
	// Distinct from plain textSecondary (unlike the day theme, where
	// textSecondary itself already clears 4.5:1 against panelBodyAlt) —
	// textSecondary alone only measures 4.18:1 here, just under AA.
	editorGutterText: 0x5c55a0,
};
