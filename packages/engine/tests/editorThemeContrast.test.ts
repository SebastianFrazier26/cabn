import { describe, expect, test } from "vitest";
import {
	DAY_TOKENS,
	NIGHT_TOKENS,
	type PixelThemeTokens,
} from "../src/react/pixelThemeTokens.js";

/** WCAG 2.x relative-luminance contrast ratio for two opaque 0xRRGGBB sRGB colors. */
function contrastRatio(a: number, b: number): number {
	const relativeLuminance = (hex: number) => {
		const linearize = (channel: number) => {
			const c = channel / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		};
		const r = linearize((hex >> 16) & 0xff);
		const g = linearize((hex >> 8) & 0xff);
		const b = linearize(hex & 0xff);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return (lighter + 0.05) / (darker + 0.05);
}

// Every fg/bg text pairing the quill editor theme renders (see
// ../src/react/editorTheme.ts) against the *actual* pixelTheme.tsx tokens
// (pixelThemeTokens.ts), not copied hexes — fails the moment either color
// drifts back below WCAG AA (4.5:1) for text, in either theme.
function editorPairs(
	tokens: PixelThemeTokens,
): Array<[role: string, fg: number, bg: number]> {
	return [
		["body text", tokens.text, tokens.panelBody],
		["gutter / line numbers", tokens.editorGutterText, tokens.panelBodyAlt],
		["comment", tokens.textSecondary, tokens.panelBody],
		["keyword", tokens.syntaxKeyword, tokens.panelBody],
		["string", tokens.syntaxString, tokens.panelBody],
		["number / bool / null / atom", tokens.syntaxNumber, tokens.panelBody],
		["function / property name", tokens.syntaxFunction, tokens.panelBody],
		["type name / class name", tokens.syntaxType, tokens.panelBody],
		// Tag name reuses syntaxString (see editorTheme.ts's own comment on why).
		["tag name", tokens.syntaxString, tokens.panelBody],
		["attribute name", tokens.syntaxAttribute, tokens.panelBody],
		["punctuation / bracket / operator", tokens.text, tokens.panelBody],
		["pensieve added line", tokens.diffAddText, tokens.diffAddBg],
		["pensieve removed line", tokens.diffDelText, tokens.diffDelBg],
		["pensieve context line", tokens.text, tokens.panelBody],
	];
}

describe("pixel-theme editor contrast", () => {
	describe("day", () => {
		test.each(editorPairs(DAY_TOKENS))(
			"%s clears WCAG AA (4.5:1) for text",
			(_role, fg, bg) => {
				expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
			},
		);
	});

	describe("night", () => {
		test.each(editorPairs(NIGHT_TOKENS))(
			"%s clears WCAG AA (4.5:1) for text",
			(_role, fg, bg) => {
				expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
			},
		);
	});
});
