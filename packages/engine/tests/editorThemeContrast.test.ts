import { describe, expect, test } from "vitest";
import { PALETTE } from "../src/palette.js";

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

// Every fg/bg text pairing the cottagecore quill editor theme renders (see
// ../src/react/editorTheme.ts) — kept as PALETTE lookups, not copied hexes, so this
// fails the moment either color drifts back below WCAG AA (4.5:1) for text.
const EDITOR_TEXT_PAIRS: Array<[role: string, fg: number, bg: number]> = [
	["body text", PALETTE.ink, PALETTE.parchment],
	["gutter / line numbers", PALETTE.rust, PALETTE.parchmentDark],
	["comment", PALETTE.trail, PALETTE.parchment],
	["keyword", PALETTE.goldDark, PALETTE.parchment],
	["string", PALETTE.biome.meadowDark, PALETTE.parchment],
	["number / bool / null / atom", PALETTE.amethystDark, PALETTE.parchment],
	["function / property name", PALETTE.rust, PALETTE.parchment],
	["type name / class name", PALETTE.plum, PALETTE.parchment],
	["tag name", PALETTE.biome.grove, PALETTE.parchment],
	["attribute name", PALETTE.biome.gladeDark, PALETTE.parchment],
	["punctuation / bracket / operator", PALETTE.ink, PALETTE.parchment],
];

describe("cottagecore editor theme contrast", () => {
	test.each(EDITOR_TEXT_PAIRS)(
		"%s clears WCAG AA (4.5:1) for text",
		(_role, fg, bg) => {
			expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
		},
	);
});
