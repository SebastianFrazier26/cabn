import { describe, expect, test } from "vitest";
import {
	DAY_TOKENS,
	NIGHT_TOKENS,
	type PixelThemeTokens,
} from "../src/react/pixelThemeTokens.js";
import { CRIMSON_TOKENS } from "../src/shadow/tokens.js";

// Same formula as editorThemeContrast.test.ts, duplicated rather than shared
// for the same reason that file gives (a self-contained, obviously-correct
// check) — this file covers the *other* half of pixelTheme.tsx: the plain
// UI chrome (buttons, badges, status text) that editorThemeContrast.test.ts
// doesn't touch, not the quill/pensieve syntax and diff colors it already
// owns.
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

// pixelTheme.tsx fixes this ink on three of the four accent-color button
// fills (.cabn-btn.confirm/neutral, the rename preview's ins/mark, the
// owner toolkit's "on" badge, the guide's confirm pill, the speed toggle's
// active state) — see its own "Fixed dark ink on the bright accents"
// comments. The fourth and fifth (pink, violet) needed their own dedicated
// ink tokens instead; see pixelThemeTokens.ts.
const FIXED_BUTTON_INK = 0x201a3d;

/** WCAG 1.4.3 (Contrast (Minimum)): real text, any size here, needs 4.5:1. */
const TEXT_MIN = 4.5;
/**
 * WCAG 1.4.11 (Non-text Contrast): a graphical object required to understand
 * content — applied here only to the two single-glyph status/cue markers
 * (the unsaved dot, the guide's "more" cue) per the 2026-09-30 user decision
 * to treat them as compact UI indicators rather than body text.
 */
const GLYPH_MIN = 3;

interface Pair {
	role: string;
	fg: number;
	bg: number;
	min: number;
}

function uiPairs(tokens: PixelThemeTokens): Pair[] {
	return [
		{
			role: "button/badge ink on green (confirm)",
			fg: FIXED_BUTTON_INK,
			bg: tokens.accentGreen,
			min: TEXT_MIN,
		},
		{
			role: "button/badge ink on pink (cancel, bag/hotbar count)",
			fg: tokens.accentPinkInk,
			bg: tokens.accentPink,
			min: TEXT_MIN,
		},
		{
			role: "button/badge ink on yellow (neutral)",
			fg: FIXED_BUTTON_INK,
			bg: tokens.accentYellow,
			min: TEXT_MIN,
		},
		{
			role: "button/badge ink on violet (spellbook kind glyph)",
			fg: tokens.accentVioletInk,
			bg: tokens.accentViolet,
			min: TEXT_MIN,
		},
		// .cabn-segmented button.selected and the owner toolkit's kbd chip.
		{
			role: "chip ink on border-outer chip",
			fg: tokens.chipInk,
			bg: tokens.borderOuter,
			min: TEXT_MIN,
		},
		// .cabn-help-row kbd: hardcoded white, not a token — already clears AA everywhere.
		{
			role: "white text on border-outer chip",
			fg: 0xffffff,
			bg: tokens.borderOuter,
			min: TEXT_MIN,
		},
		// .cabn-pet-status.error
		{
			role: "pet error text on panel body",
			fg: tokens.errorInk,
			bg: tokens.panelBody,
			min: TEXT_MIN,
		},
		// FileStatusLine's "● unsaved" marker — a compact status glyph, not a sentence.
		{
			role: "unsaved marker (glyph) on panel body",
			fg: tokens.warnInk,
			bg: tokens.panelBody,
			min: GLYPH_MIN,
		},
		// GuideDialog's "▼ more" cue — a single decorative indicator glyph.
		{
			role: "guide more-cue (glyph) on panel body",
			fg: tokens.guideMoreInk,
			bg: tokens.panelBody,
			min: GLYPH_MIN,
		},
	];
}

function run(theme: string, tokens: PixelThemeTokens): void {
	describe(theme, () => {
		test.each(uiPairs(tokens))(
			"$role clears its WCAG threshold ($min:1)",
			({ fg, bg, min }) => {
				expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
			},
		);
	});
}

describe("pixel-theme UI chrome contrast", () => {
	run("day", DAY_TOKENS);
	run("night", NIGHT_TOKENS);
	run("crimson", CRIMSON_TOKENS);
});
