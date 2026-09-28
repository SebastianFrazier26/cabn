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

// 2026-09-28: was previously a near-white lavender panel (0xeeeaff) with dark
// text — a re-tinted *light* theme wearing night colors, not an actual dark
// mode (playtest feedback: "the UI night theme must read as a true dark
// mode"). Now the panel itself goes dark and the text/syntax set flips to
// light-on-dark, computed fresh (not just eyeballed) against the new
// panelBody/panelBodyAlt via the same contrastRatio() editorThemeContrast.test.ts
// uses, so every pair here is proven >=4.5:1 before it shipped. Accent-* stay
// the same vivid tones the old night theme already used (they were never the
// problem — only the panel/text pairing was) except where noted.
export const NIGHT_TOKENS: PixelThemeTokens = {
	panelBody: 0x1c1836,
	panelBodyAlt: 0x140f28,
	// Brightened from a near-black 0x221a4d so the panel's own border is still
	// visible against the new dark panelBody (a border needs to read as an
	// edge, not vanish into the fill it's outlining).
	borderOuter: 0x554aa0,
	borderHighlight: 0xffd23f,
	text: 0xf1ecff,
	textSecondary: 0xb7aee0,
	accentYellow: 0xffcf4d,
	accentGreen: 0x46d19a,
	accentPink: 0xff4fa0,
	accentOrange: 0xff7a45,
	accentCyan: 0x46c9e0,
	accentViolet: 0x7a5fe0,
	// Lightened variants of the accents, not darkened (opposite technique from
	// DAY_TOKENS) — a near-black panel needs bright text, not dark.
	syntaxKeyword: 0xff9e5c,
	syntaxString: 0x8fe3a0,
	syntaxNumber: 0xc3b2ff,
	syntaxFunction: 0x7fe6f0,
	syntaxType: 0xff9fd0,
	syntaxAttribute: 0xffe28a,
	editorGutterText: 0xa89fd8,
};
