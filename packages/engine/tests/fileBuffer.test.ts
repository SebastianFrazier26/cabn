import { redo, undo } from "@codemirror/commands";
import { EditorState, type StateCommand } from "@codemirror/state";
import { beforeEach, describe, expect, it } from "vitest";
import { createCabnBus } from "../src/bridge/events.js";
import { createCabnStore } from "../src/bridge/store.js";
import {
	fileCaretHints,
	isActiveFileDirty,
	saveActiveFile,
	spellbookCompartment,
} from "../src/systems/fileBuffer.js";

type Store = ReturnType<typeof createCabnStore>;

function run(store: Store, command: StateCommand): void {
	const state = store.getState().activeFileState as EditorState;
	command({
		state,
		dispatch: (tr) => store.getState().setActiveFileState(tr.state),
	});
}

function type(store: Store, text: string): void {
	const state = store.getState().activeFileState as EditorState;
	store
		.getState()
		.setActiveFileState(
			state.update(state.replaceSelection(text), { userEvent: "input.type" })
				.state,
		);
}

describe("shared file buffer", () => {
	let store: Store;
	beforeEach(() => {
		store = createCabnStore();
	});

	it("is created for text files only, with the caret at the top", () => {
		store.getState().enterPortal("a.ts", "one\ntwo");
		const state = store.getState().activeFileState;
		expect(state?.doc.toString()).toBe("one\ntwo");
		expect(state?.selection.main.head).toBe(0);
		expect(isActiveFileDirty(store.getState())).toBe(false);

		store.getState().enterPortal("logo.png", null);
		expect(store.getState().activeFileState).toBeNull();
		expect(isActiveFileDirty(store.getState())).toBe(false);
	});

	it("goes dirty on an edit and clean again when undone back to the saved text", () => {
		store.getState().enterPortal("a.ts", "one");
		type(store, "x");
		expect(store.getState().activeFileState?.doc.toString()).toBe("xone");
		expect(isActiveFileDirty(store.getState())).toBe(true);
		run(store, undo);
		expect(isActiveFileDirty(store.getState())).toBe(false);
		run(store, redo);
		expect(isActiveFileDirty(store.getState())).toBe(true);
	});

	it("saves through editor:save, and the save marks the buffer clean", () => {
		const bus = createCabnBus();
		const saves: string[] = [];
		bus.on("editor:save", ({ portalId, content }) => {
			saves.push(`${portalId}=${content}`);
			store.getState().setActivePortalContent(content);
		});
		store.getState().enterPortal("a.ts", "one");
		type(store, "x");
		const before = store.getState().activeFileState;
		saveActiveFile(store, bus);
		expect(saves).toEqual(["a.ts=xone"]);
		expect(store.getState().activePortalContent).toBe("xone");
		// Same state object: a save must not reset the caret or the history.
		expect(store.getState().activeFileState).toBe(before);
		expect(isActiveFileDirty(store.getState())).toBe(false);
	});

	it("a reset to pristine replaces the text undoably and counts as saved", () => {
		store.getState().enterPortal("a.ts", "pristine");
		type(store, "edited ");
		store.getState().setActivePortalContent("pristine");
		expect(store.getState().activeFileState?.doc.toString()).toBe("pristine");
		expect(isActiveFileDirty(store.getState())).toBe(false);
		run(store, undo);
		expect(store.getState().activeFileState?.doc.toString()).toBe(
			"edited pristine",
		);
	});

	it("an encounter's openEditor moves the caret; the quill's keeps it", () => {
		store.getState().enterPortal("a.ts", "a\nbb\nccc");
		const state = store.getState().activeFileState as EditorState;
		store
			.getState()
			.setActiveFileState(state.update({ selection: { anchor: 4 } }).state);
		store.getState().openEditor({ language: "typescript" });
		expect(store.getState().activeFileState?.selection.main.head).toBe(4);
		expect(store.getState().editorInitialLine).toBe(1);
		store.getState().closeEditor();
		store.getState().openEditor({ initialLine: 2, language: undefined });
		expect(store.getState().activeFileState?.selection.main.head).toBe(5);
		expect(store.getState().editorInitialLine).toBe(2);
	});

	it("keeps undo history across the spellbook's compartment reconfigure", () => {
		store.getState().enterPortal("a.ts", "base");
		type(store, "typed in the file view ");
		const inFileView = store.getState().activeFileState as EditorState;
		const opened = inFileView.update({
			effects: spellbookCompartment.reconfigure([EditorState.tabSize.of(8)]),
		}).state;
		store.getState().setActiveFileState(opened);
		run(store, undo);
		expect(store.getState().activeFileState?.doc.toString()).toBe("base");
		const closed = (store.getState().activeFileState as EditorState).update({
			effects: spellbookCompartment.reconfigure([]),
		}).state;
		store.getState().setActiveFileState(closed);
		run(store, redo);
		expect(store.getState().activeFileState?.doc.toString()).toBe(
			"typed in the file view base",
		);
	});

	it("drops the buffer and any leave prompt on exit", () => {
		store.getState().enterPortal("a.ts", "x");
		store.getState().setFileLeavePrompt(true);
		store.getState().exitPortal();
		expect(store.getState().activeFileState).toBeNull();
		expect(store.getState().activeFileSavedDoc).toBeNull();
		expect(store.getState().fileLeavePrompt).toBe(false);
	});

	it("spells the status line's keybinds for the platform", () => {
		expect(fileCaretHints(true)).toContain("Cmd+S save");
		expect(fileCaretHints(true)).toContain("⌥Enter fight");
		expect(fileCaretHints(false)).toContain("Alt+Q spellbook");
	});
});
