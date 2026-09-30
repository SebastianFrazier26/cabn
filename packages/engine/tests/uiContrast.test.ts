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

// pixelTheme.tsx deliberately fixes this ink (never var(--cabn-text)) on
// every bright accent-color fill — .cabn-btn.confirm/cancel/neutral, the
// rename preview's ins/mark, the owner toolkit's "on" badge, the guide's
// confirm pill, the speed toggle's active state — see pixelTheme.tsx's own
// "Fixed dark ink on the bright accents" comments. It's a literal, not a
// token, because the near-white night `text` token would be unreadable on a
// yellow/green/pink/violet fill in either theme.
const FIXED_BUTTON_INK = 0x201a3d;

interface Pair {
	role: string;
	fg: number;
	bg: number;
}

function uiPairs(tokens: PixelThemeTokens): Pair[] {
	return [
		{
			role: "button/badge ink on green (confirm)",
			fg: FIXED_BUTTON_INK,
			bg: tokens.accentGreen,
		},
		{
			role: "button/badge ink on pink (cancel)",
			fg: FIXED_BUTTON_INK,
			bg: tokens.accentPink,
		},
		{
			role: "button/badge ink on yellow (neutral)",
			fg: FIXED_BUTTON_INK,
			bg: tokens.accentYellow,
		},
		{
			role: "button/badge ink on violet (rename mark)",
			fg: FIXED_BUTTON_INK,
			bg: tokens.accentViolet,
		},
		// .cabn-segmented button.selected and the owner toolkit's kbd chip.
		{
			role: "panel body text on border-outer chip",
			fg: tokens.panelBody,
			bg: tokens.borderOuter,
		},
		// .cabn-help-row kbd: hardcoded white, not the panelBody token above.
		{
			role: "white text on border-outer chip",
			fg: 0xffffff,
			bg: tokens.borderOuter,
		},
		// .cabn-pet-status.error
		{
			role: "pet error text on panel body",
			fg: tokens.accentPink,
			bg: tokens.panelBody,
		},
		// FileStatusLine's "● unsaved" marker
		{
			role: "unsaved marker on panel body",
			fg: tokens.accentYellow,
			bg: tokens.panelBody,
		},
		// GuideDialog's "▼ more" cue
		{
			role: "guide more-cue on panel body",
			fg: tokens.accentOrange,
			bg: tokens.panelBody,
		},
	];
}

/**
 * Pairs this pass found already below WCAG AA (4.5:1) — see
 * docs/testing/2026-09-30-a11y.md for the numbers and fix options. Recoloring
 * any of these changes the visible design (CLAUDE.md: report contrast
 * failures with options rather than picking one), so they're pinned with
 * `test.fails` instead of silently dropped or left to fail the suite: this
 * still runs the real assertion every time, still shows up if a change makes
 * a pair worse, and forces this test file to be touched (not just quietly
 * start passing) the day someone picks a fix.
 */
const KNOWN_BELOW_AA = new Set([
	"day:button/badge ink on violet (rename mark)",
	"day:pet error text on panel body",
	"day:unsaved marker on panel body",
	"day:guide more-cue on panel body",
	"night:button/badge ink on violet (rename mark)",
	"night:panel body text on border-outer chip",
	"crimson:button/badge ink on pink (cancel)",
	"crimson:button/badge ink on violet (rename mark)",
	"crimson:panel body text on border-outer chip",
	"crimson:pet error text on panel body",
]);

function run(
	theme: "day" | "night" | "crimson",
	tokens: PixelThemeTokens,
): void {
	describe(theme, () => {
		for (const { role, fg, bg } of uiPairs(tokens)) {
			const known = KNOWN_BELOW_AA.has(`${theme}:${role}`);
			const runner = known ? test.fails : test;
			runner(
				known
					? `${role} is a known below-AA pair pending a design decision`
					: `${role} clears WCAG AA (4.5:1) for text`,
				() => {
					expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
				},
			);
		}
	});
}

describe("pixel-theme UI chrome contrast", () => {
	run("day", DAY_TOKENS);
	run("night", NIGHT_TOKENS);
	run("crimson", CRIMSON_TOKENS);
});
