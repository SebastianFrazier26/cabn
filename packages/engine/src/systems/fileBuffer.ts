import { history } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { detectIndentUnit } from "./editorFormat.js";

/**
 * The open file's one edit buffer, shared by the file view's inline caret
 * and the spellbook. It's a headless CodeMirror EditorState held in the
 * store (`activeFileState`), so both views edit the same document, the same
 * selection and the same undo history: typing in the file view and pressing
 * Cmd/Ctrl+Z inside the spellbook undoes that typing, and the spellbook
 * opens at the file view's caret. The spellbook mounts its view-only
 * extensions (language, keymaps, theme, search) into this compartment on
 * open and empties it on close — reconfiguring a compartment keeps every
 * state field present in both configurations, which is what carries the
 * history across.
 */
export const spellbookCompartment = new Compartment();

export function createFileBufferState(content: string): EditorState {
	return EditorState.create({
		doc: content,
		extensions: [
			history(),
			indentUnit.of(detectIndentUnit(content)),
			spellbookCompartment.of([]),
		],
	});
}

/** Unsaved = the buffer differs from what was last saved (or loaded) — so undoing back to the saved text reads as clean again. */
export function isFileDirty(
	state: EditorState | null,
	savedDoc: Text | null,
): boolean {
	if (!state || !savedDoc) return false;
	return !state.doc.eq(savedDoc);
}

export function isActiveFileDirty(s: {
	activeFileState: EditorState | null;
	activeFileSavedDoc: Text | null;
}): boolean {
	return isFileDirty(s.activeFileState, s.activeFileSavedDoc);
}

/** The one save path for both views: `editor:save` is what FileScene (monster re-check, store content) and WorldScene (localStorage override, arch preview) already listen for. */
export function saveActiveFile(store: StoreApi<CabnStore>, bus: CabnBus): void {
	const { activePortalId, activeFileState } = store.getState();
	if (!activePortalId || !activeFileState) return;
	bus.emit("editor:save", {
		portalId: activePortalId,
		content: activeFileState.doc.toString(),
	});
}

/** The file view status line's keybind row — Alt/Cmd spelled for the platform. */
export function fileCaretHints(isMac: boolean): string {
	const mod = isMac ? "Cmd" : "Ctrl";
	const alt = isMac ? "⌥" : "Alt+";
	return [
		`${mod}+S save`,
		`${mod}+Z undo`,
		`${alt}Enter fight a monster by the caret`,
		`${alt}Q spellbook`,
		`${alt}B copy to bag`,
		`${alt}R run`,
		"Esc leave",
	].join(" · ");
}
