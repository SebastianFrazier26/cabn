import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * Quill/editor CM theme, repainted (2026-09-28) from the original cottagecore
 * parchment look to the pixel-theme's own token set (pixelTheme.tsx) — every
 * value below is a `var(--cabn-*)` CSS custom property, not a literal hex, so
 * this single theme object renders correctly under both `data-theme="day"`
 * and `data-theme="night"` (CodeMirror's generated stylesheet just references
 * whatever the ancestor `.cabn-pixel-root` currently resolves that property
 * to — no need to pick a day/night variant at EditorView-creation time, and a
 * live day/night flip while the editor is already open repaints it for free).
 * `--cabn-syntax-*`/`--cabn-editor-gutter-text` are per-theme-darkened
 * variants of the shared accent tokens, computed the same way
 * palette.ts's `goldDark`/`amethystDark`/etc. were — see
 * packages/engine/tests/editorThemeContrast.test.ts, which pins every
 * fg/bg pair at >=4.5:1 (WCAG AA for text) for both themes so a future accent
 * change can't silently regress it.
 */
export const pixelEditorTheme: Extension = EditorView.theme(
	{
		"&": {
			backgroundColor: "var(--cabn-panel-body)",
			color: "var(--cabn-text)",
			height: "100%",
			// Bumped from 13px (2026-09-28 polish pass — the previous size read
			// as too small/dense against the rest of the pixel-theme's chrome).
			fontSize: "15px",
		},
		".cm-content": {
			fontFamily: "var(--cabn-font-mono)",
			caretColor: "var(--cabn-text)",
			padding: "8px 0",
		},
		".cm-cursor, .cm-dropCursor": {
			borderLeftColor: "var(--cabn-text)",
			borderLeftWidth: "2px",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "var(--cabn-editor-selection-bg)",
		},
		".cm-activeLine": {
			backgroundColor: "var(--cabn-editor-active-line-bg)",
		},
		".cm-gutters": {
			backgroundColor: "var(--cabn-panel-body-alt)",
			color: "var(--cabn-editor-gutter-text)",
			border: "none",
			borderRight: "1px solid var(--cabn-editor-gutter-border)",
		},
		".cm-activeLineGutter": {
			backgroundColor: "var(--cabn-editor-active-gutter-bg)",
		},
		".cm-scroller": {
			fontFamily: "var(--cabn-font-mono)",
		},
	},
	{ dark: false },
);

export const pixelHighlightStyle = HighlightStyle.define([
	{
		tag: t.comment,
		color: "var(--cabn-text-secondary)",
		fontStyle: "italic",
	},
	{
		tag: [t.keyword, t.controlKeyword, t.operatorKeyword],
		color: "var(--cabn-syntax-keyword)",
		fontWeight: "bold",
	},
	{
		tag: [t.string, t.special(t.string)],
		color: "var(--cabn-syntax-string)",
	},
	{
		tag: [t.number, t.bool, t.null, t.atom],
		color: "var(--cabn-syntax-number)",
	},
	{
		tag: [t.function(t.variableName), t.propertyName],
		color: "var(--cabn-syntax-function)",
	},
	{ tag: [t.typeName, t.className], color: "var(--cabn-syntax-type)" },
	{
		tag: [t.tagName],
		// Reuses --cabn-syntax-string rather than a dedicated token — tag names
		// and strings don't co-occur in the same file type here (markup vs.
		// code), same "reuse across roles that never render together" shape
		// the original theme's `rust` (gutter + function/property) already used.
		color: "var(--cabn-syntax-string)",
		fontWeight: "bold",
	},
	{ tag: [t.attributeName], color: "var(--cabn-syntax-attribute)" },
	{
		tag: [t.punctuation, t.bracket, t.operator],
		color: "var(--cabn-text)",
	},
]);

export const pixelEditorExtensions: Extension = [
	pixelEditorTheme,
	syntaxHighlighting(pixelHighlightStyle),
	lineNumbers(),
];
