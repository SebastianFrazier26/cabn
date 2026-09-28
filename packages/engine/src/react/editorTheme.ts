import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { PALETTE, toCssColor } from "../palette.js";

/**
 * Cottagecore CM theme: parchment surface, ink text, warm-palette syntax
 * colors, pale-ghost-blue selection (the one deliberately cool color, so a
 * selection still reads as distinct against an otherwise warm page). All
 * colors come from palette.ts (see its own comment on why — a hand-copy of
 * the generated palette, not invented hexes).
 */
export const cottagecoreEditorTheme: Extension = EditorView.theme(
	{
		"&": {
			backgroundColor: toCssColor(PALETTE.parchment),
			color: toCssColor(PALETTE.ink),
			height: "100%",
			fontSize: "13px",
		},
		".cm-content": {
			fontFamily: '"Courier New", monospace',
			caretColor: toCssColor(PALETTE.ink),
			padding: "8px 0",
		},
		".cm-cursor, .cm-dropCursor": {
			borderLeftColor: toCssColor(PALETTE.ink),
			borderLeftWidth: "2px",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: `${toCssColor(PALETTE.paleGhostBlue)}99`,
		},
		".cm-activeLine": {
			backgroundColor: `${toCssColor(PALETTE.gold)}22`,
		},
		".cm-gutters": {
			backgroundColor: toCssColor(PALETTE.parchmentDark),
			// rust, not trail: trail-on-parchmentDark is only 3.5:1, below WCAG AA for text (2026-09-28).
			color: toCssColor(PALETTE.rust),
			border: "none",
			borderRight: `1px solid ${toCssColor(PALETTE.trail)}55`,
		},
		".cm-activeLineGutter": {
			backgroundColor: `${toCssColor(PALETTE.gold)}33`,
		},
		".cm-scroller": {
			fontFamily: '"Courier New", monospace',
		},
	},
	{ dark: false },
);

// All colors below render as text on `parchment` and must clear WCAG AA (4.5:1) for text;
// see packages/engine/tests/editorThemeContrast.test.ts. gold/amethyst/meadow/glade's plain
// swatches don't clear it at this lightness, hence the *Dark variants (see palette.ts).
export const cottagecoreHighlightStyle = HighlightStyle.define([
	{ tag: t.comment, color: toCssColor(PALETTE.trail), fontStyle: "italic" },
	{
		tag: [t.keyword, t.controlKeyword, t.operatorKeyword],
		color: toCssColor(PALETTE.goldDark),
		fontWeight: "bold",
	},
	{
		tag: [t.string, t.special(t.string)],
		color: toCssColor(PALETTE.biome.meadowDark),
	},
	{
		tag: [t.number, t.bool, t.null, t.atom],
		color: toCssColor(PALETTE.amethystDark),
	},
	{
		tag: [t.function(t.variableName), t.propertyName],
		color: toCssColor(PALETTE.rust),
	},
	{ tag: [t.typeName, t.className], color: toCssColor(PALETTE.plum) },
	{
		tag: [t.tagName],
		color: toCssColor(PALETTE.biome.grove),
		fontWeight: "bold",
	},
	{ tag: [t.attributeName], color: toCssColor(PALETTE.biome.gladeDark) },
	{
		tag: [t.punctuation, t.bracket, t.operator],
		// ink, not steelGray: steelGray-on-parchment is only 2.43:1, below WCAG AA for text (2026-09-28).
		color: toCssColor(PALETTE.ink),
	},
]);

export const cottagecoreEditorExtensions: Extension = [
	cottagecoreEditorTheme,
	syntaxHighlighting(cottagecoreHighlightStyle),
];
