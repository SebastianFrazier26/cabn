import { toggleComment } from "@codemirror/commands";
import {
	codeFolding,
	ensureSyntaxTree,
	foldAll,
	foldGutter,
	foldKeymap,
	foldService,
	indentRange,
	indentUnit,
	syntaxTree,
	unfoldAll,
} from "@codemirror/language";
import {
	highlightSelectionMatches,
	openSearchPanel,
	search,
	searchKeymap,
} from "@codemirror/search";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import {
	defaultFormatOptions,
	detectIndentUnit,
	formatText,
	lineChanges,
	linesEndingInside,
	shouldReindent,
} from "../systems/editorFormat.js";
import { indentationFoldEnd } from "../systems/editorOutline.js";
import {
	nonCodeRanges,
	type RenameOccurrence,
	type TextRange,
} from "../systems/editorRename.js";
import {
	SPELLBOOK_TOOLS,
	type SpellbookToolId,
} from "../systems/spellbookTools.js";

/** Parse budget before falling back to whatever tree is already there — keeps a huge file from freezing a keypress. */
const PARSE_TIMEOUT_MS = 150;

export function nonCodeRangesFor(state: EditorState): TextRange[] {
	const tree =
		ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS) ??
		syntaxTree(state);
	return nonCodeRanges(tree);
}

function hasParseErrors(state: EditorState): boolean {
	let found = false;
	syntaxTree(state).iterate({
		enter(node) {
			if (node.type.isError) found = true;
			return !found;
		},
	});
	return found;
}

/**
 * Re-indent via the language's own indentation rules (in the file's own
 * indent unit — see `spellbookToolExtensions`), then trim trailing whitespace and add the final newline —
 * dispatched as minimal per-line edits in one transaction, so a single undo
 * reverts the whole format. Returns a note for the user when re-indenting
 * was deliberately skipped.
 */
export function formatDocument(
	view: EditorView,
	language: string | undefined,
): string | null {
	const { state } = view;
	const before = state.doc.toString();
	ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
	let note: string | null = null;
	let indented = before;
	if (!shouldReindent(language)) {
		note = "Whitespace tidied — indentation left alone (it's structure here)";
	} else if (hasParseErrors(state)) {
		// An unclosed bracket makes every later line indent to that bracket's
		// column; re-indenting a broken file does more harm than good.
		note = "Whitespace tidied — fix the syntax error to re-indent";
	} else {
		indented = indentRange(state, 0, state.doc.length)
			.apply(state.doc)
			.toString();
	}
	// Re-indenting never adds or removes lines, so line indexes computed on
	// the original text still name the same lines in `indented`.
	const protectedLines = linesEndingInside(before, nonCodeRangesFor(state));
	const after = formatText(indented, {
		...defaultFormatOptions(language),
		protectedLines,
	});
	const changes = lineChanges(before, after);
	if (changes.length > 0) {
		view.dispatch({ changes, userEvent: "input.format", scrollIntoView: true });
	}
	return note;
}

export function applyRenameInView(
	view: EditorView,
	occurrences: readonly RenameOccurrence[],
	newName: string,
): void {
	if (occurrences.length === 0) return;
	view.dispatch({
		changes: occurrences.map((o) => ({
			from: o.from,
			to: o.to,
			insert: newName,
		})),
		userEvent: "input.rename",
	});
}

export function openReplacePanel(view: EditorView): boolean {
	openSearchPanel(view);
	const replaceField = view.dom.querySelector<HTMLInputElement>(
		".cm-search input[name=replace]",
	);
	if (!replaceField) return true;
	// With text already in the find field, jump straight to "replace with".
	const findField = view.dom.querySelector<HTMLInputElement>(
		".cm-search input[name=search]",
	);
	(findField?.value ? replaceField : findField)?.focus();
	return true;
}

/** Editor-local commands; tools that open React dialogs (rename, goto, symbol) or live outside CM (run, save) come through `handlers`. */
export function runEditorCommand(
	id: SpellbookToolId,
	view: EditorView,
	language: string | undefined,
	onNote: (message: string) => void = () => {},
): boolean {
	switch (id) {
		case "find":
			return openSearchPanel(view);
		case "replace":
			return openReplacePanel(view);
		case "format": {
			const note = formatDocument(view, language);
			if (note) onNote(note);
			return true;
		}
		case "comment":
			return toggleComment(view);
		case "foldAll":
			return foldAll(view);
		case "unfoldAll":
			return unfoldAll(view);
		default:
			return false;
	}
}

function foldMarker(open: boolean): HTMLElement {
	const el = document.createElement("span");
	el.className = `cabn-fold-marker${open ? "" : " folded"}`;
	el.textContent = open ? "▾" : "▸";
	el.title = open ? "Fold" : "Unfold";
	return el;
}

/** Only used when no language pack is loaded — a real grammar's own fold ranges are better than an indentation guess. */
const indentationFolding = foldService.of((state, lineStart) => {
	const line = state.doc.lineAt(lineStart);
	const lines: string[] = [];
	// Look ahead a bounded window rather than splitting the whole doc per line.
	const lastLine = Math.min(state.doc.lines, line.number + 2000);
	for (let n = line.number; n <= lastLine; n++)
		lines.push(state.doc.line(n).text);
	const end = indentationFoldEnd(lines, 0);
	if (end === null) return null;
	return { from: line.to, to: state.doc.line(line.number + end).to };
});

export interface SpellbookToolHandlers {
	/** Called for every tool whose action lives outside CodeMirror. */
	onTool(id: SpellbookToolId): void;
	/** A transient message for the user (e.g. why Format skipped re-indenting). */
	onNote(message: string): void;
}

/**
 * Search/replace, folding and the toolbar's keybinds. The keymap sits at
 * Prec.highest so e.g. Ctrl+G reaches "go to line" rather than
 * searchKeymap's Ctrl+G findNext on Windows/Linux.
 */
export function spellbookToolExtensions(
	language: string | undefined,
	hasLanguagePack: boolean,
	initialDoc: string,
	handlers: SpellbookToolHandlers,
): Extension {
	const toolBindings = SPELLBOOK_TOOLS.flatMap((tool) =>
		tool.keys.map((key) => ({
			key,
			preventDefault: true,
			run: (view: EditorView) => {
				if (runEditorCommand(tool.id, view, language, handlers.onNote)) {
					return true;
				}
				handlers.onTool(tool.id);
				return true;
			},
		})),
	);
	return [
		// Learned once per open so Tab, Enter and Format all indent the way
		// this file already does rather than in CodeMirror's default 2 spaces.
		indentUnit.of(detectIndentUnit(initialDoc)),
		search({ top: true }),
		highlightSelectionMatches(),
		codeFolding(),
		foldGutter({ markerDOM: foldMarker }),
		...(hasLanguagePack ? [] : [indentationFolding]),
		Prec.highest(keymap.of(toolBindings)),
		keymap.of([...searchKeymap, ...foldKeymap]),
	];
}
