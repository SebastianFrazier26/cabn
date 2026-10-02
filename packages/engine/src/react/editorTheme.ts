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
		// Find & replace panel (@codemirror/search), repainted from its default
		// grey browser-form look into the spellbook's flat pixel chrome.
		".cm-panels": {
			backgroundColor: "var(--cabn-panel-body-alt)",
			color: "var(--cabn-text)",
		},
		".cm-panels.cm-panels-top": {
			borderBottom: "3px solid var(--cabn-border-outer)",
		},
		".cm-panel.cm-search": {
			fontFamily: "var(--cabn-font-display)",
			fontSize: "12px",
			padding: "6px 30px 6px 8px",
			display: "flex",
			flexWrap: "wrap",
			alignItems: "center",
			gap: "6px",
		},
		".cm-panel.cm-search br": { flexBasis: "100%", height: 0 },
		".cm-textfield": {
			fontFamily: "var(--cabn-font-mono)",
			fontSize: "13px",
			color: "var(--cabn-text)",
			backgroundColor: "var(--cabn-panel-body)",
			border: "2px solid var(--cabn-border-outer)",
			borderRadius: "6px",
			padding: "3px 6px",
			margin: 0,
		},
		".cm-textfield:focus": {
			outline: "2px solid var(--cabn-accent-yellow)",
			outlineOffset: "1px",
		},
		// Fixed dark ink on the bright accent fill, same reasoning as .cabn-btn.
		".cm-button": {
			fontFamily: "var(--cabn-font-display)",
			fontSize: "11px",
			color: "#201a3d",
			backgroundColor: "var(--cabn-accent-yellow)",
			backgroundImage: "none",
			border: "2px solid var(--cabn-border-outer)",
			borderRadius: "8px",
			padding: "3px 10px",
			margin: 0,
			cursor: "pointer",
		},
		".cm-button:active": {
			backgroundImage: "none",
			transform: "translate(1px, 1px)",
		},
		".cm-panel.cm-search label": {
			display: "inline-flex",
			alignItems: "center",
			gap: "3px",
			fontSize: "11px",
			margin: 0,
		},
		".cm-panel.cm-search input[type=checkbox]": {
			accentColor: "var(--cabn-accent-violet)",
			margin: 0,
		},
		".cm-panel.cm-search [name=close]": {
			color: "var(--cabn-text)",
			fontSize: "20px",
			top: "4px",
			right: "8px",
			cursor: "pointer",
		},
		".cm-searchMatch": {
			backgroundColor: "var(--cabn-search-match-bg)",
			outline: "1px solid var(--cabn-accent-orange)",
		},
		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: "var(--cabn-search-match-selected-bg)",
		},
		".cm-selectionMatch": {
			backgroundColor: "var(--cabn-selection-match-bg)",
		},
		".cm-foldPlaceholder": {
			fontFamily: "var(--cabn-font-display)",
			backgroundColor: "var(--cabn-accent-violet)",
			color: "#201a3d",
			border: "none",
			borderRadius: "4px",
			padding: "0 6px",
			margin: "0 4px",
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
