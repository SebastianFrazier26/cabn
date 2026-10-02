import { describe, expect, it } from "vitest";
import {
	type CaretKeyEvent,
	fileCaretAction,
} from "../src/systems/fileCaretKeys.js";

function key(
	k: string,
	mods: Partial<Omit<CaretKeyEvent, "key">> = {},
): CaretKeyEvent {
	return {
		key: k,
		code: mods.code ?? (/^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : k),
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...mods,
	};
}

describe("fileCaretAction", () => {
	it("types printable characters, including shifted ones and space", () => {
		expect(fileCaretAction(key("a"), false)).toEqual({
			kind: "insert",
			text: "a",
		});
		expect(fileCaretAction(key("A", { shiftKey: true }), true)).toEqual({
			kind: "insert",
			text: "A",
		});
		expect(fileCaretAction(key(" ", { code: "Space" }), true)).toEqual({
			kind: "insert",
			text: " ",
		});
	});

	it("resolves the Enter conflict: plain Enter is a newline, Alt+Enter interacts", () => {
		expect(fileCaretAction(key("Enter"), true)).toEqual({ kind: "newline" });
		expect(fileCaretAction(key("Enter", { shiftKey: true }), false)).toEqual({
			kind: "newline",
		});
		expect(fileCaretAction(key("Enter", { altKey: true }), true)).toEqual({
			kind: "interact",
		});
		expect(fileCaretAction(key("Enter", { metaKey: true }), true)).toEqual({
			kind: "passthrough",
		});
	});

	it("maps arrows by platform: word jumps on Alt (mac) / Ctrl (others)", () => {
		expect(fileCaretAction(key("ArrowLeft"), true)).toEqual({
			kind: "move",
			motion: "charLeft",
			extend: false,
		});
		expect(fileCaretAction(key("ArrowLeft", { altKey: true }), true)).toEqual({
			kind: "move",
			motion: "wordLeft",
			extend: false,
		});
		expect(
			fileCaretAction(key("ArrowRight", { ctrlKey: true }), false),
		).toEqual({ kind: "move", motion: "wordRight", extend: false });
		expect(fileCaretAction(key("ArrowRight", { metaKey: true }), true)).toEqual(
			{ kind: "move", motion: "lineEnd", extend: false },
		);
		expect(
			fileCaretAction(key("ArrowUp", { metaKey: true, shiftKey: true }), true),
		).toEqual({ kind: "move", motion: "docStart", extend: true });
		expect(
			fileCaretAction(key("ArrowDown", { shiftKey: true }), false),
		).toEqual({ kind: "move", motion: "lineDown", extend: true });
	});

	it("Home/End go to the line, or the document with the platform modifier", () => {
		expect(fileCaretAction(key("Home"), false)).toMatchObject({
			motion: "lineStart",
		});
		expect(fileCaretAction(key("End", { ctrlKey: true }), false)).toMatchObject(
			{ motion: "docEnd" },
		);
		expect(fileCaretAction(key("Home", { metaKey: true }), true)).toMatchObject(
			{ motion: "docStart" },
		);
		expect(fileCaretAction(key("PageDown"), true)).toMatchObject({
			motion: "pageDown",
		});
	});

	it("deletes by char, word and line", () => {
		expect(fileCaretAction(key("Backspace"), true)).toEqual({
			kind: "delete",
			motion: "charLeft",
		});
		expect(fileCaretAction(key("Backspace", { altKey: true }), true)).toEqual({
			kind: "delete",
			motion: "wordLeft",
		});
		expect(fileCaretAction(key("Backspace", { ctrlKey: true }), false)).toEqual(
			{ kind: "delete", motion: "wordLeft" },
		);
		expect(fileCaretAction(key("Backspace", { metaKey: true }), true)).toEqual({
			kind: "delete",
			motion: "lineStart",
		});
		expect(fileCaretAction(key("Delete"), false)).toEqual({
			kind: "delete",
			motion: "charRight",
		});
	});

	it("undo/redo/save/select-all on the platform modifier only", () => {
		expect(fileCaretAction(key("z", { metaKey: true }), true)).toEqual({
			kind: "undo",
		});
		expect(
			fileCaretAction(key("z", { metaKey: true, shiftKey: true }), true),
		).toEqual({ kind: "redo" });
		expect(fileCaretAction(key("y", { ctrlKey: true }), false)).toEqual({
			kind: "redo",
		});
		expect(fileCaretAction(key("s", { ctrlKey: true }), false)).toEqual({
			kind: "save",
		});
		expect(fileCaretAction(key("a", { metaKey: true }), true)).toEqual({
			kind: "selectAll",
		});
		// Ctrl on a Mac isn't the modifier — no undo, no typing.
		expect(fileCaretAction(key("z", { ctrlKey: true }), true)).toEqual({
			kind: "passthrough",
		});
	});

	it("leaves clipboard and browser chords to the browser", () => {
		for (const k of ["c", "v", "x", "f", "r"]) {
			expect(fileCaretAction(key(k, { metaKey: true }), true)).toEqual({
				kind: "passthrough",
			});
		}
	});

	it("moves tool hotkeys to Alt+letter, by physical key", () => {
		// Windows/Linux: Alt+B reports the plain letter.
		expect(fileCaretAction(key("b", { altKey: true }), false)).toEqual({
			kind: "tool",
			toolId: "bag",
		});
		// US macOS: Option+Q types "œ".
		expect(
			fileCaretAction(key("œ", { altKey: true, code: "KeyQ" }), true),
		).toEqual({ kind: "tool", toolId: "quill" });
		expect(
			fileCaretAction(key("®", { altKey: true, code: "KeyR" }), true),
		).toEqual({ kind: "tool", toolId: "wand" });
	});

	it("types the layout's ASCII symbol instead of a tool (German macOS Option+L is @)", () => {
		expect(
			fileCaretAction(key("@", { altKey: true, code: "KeyL" }), true),
		).toEqual({ kind: "insert", text: "@" });
		// Windows AltGr (Ctrl+Alt) types too.
		expect(
			fileCaretAction(
				key("{", { altKey: true, ctrlKey: true, code: "Digit7" }),
				false,
			),
		).toEqual({ kind: "insert", text: "{" });
	});

	it("pastes bag slots on Alt+1-5, like the spellbook", () => {
		expect(
			fileCaretAction(key("¡", { altKey: true, code: "Digit1" }), true),
		).toEqual({ kind: "pasteSlot", index: 0 });
		expect(
			fileCaretAction(key("5", { altKey: true, code: "Digit5" }), false),
		).toEqual({ kind: "pasteSlot", index: 4 });
	});

	it("Tab indents, Shift+Tab dedents, Esc escapes", () => {
		expect(fileCaretAction(key("Tab"), true)).toEqual({ kind: "indent" });
		expect(fileCaretAction(key("Tab", { shiftKey: true }), true)).toEqual({
			kind: "dedent",
		});
		expect(fileCaretAction(key("Escape"), true)).toEqual({ kind: "escape" });
	});

	it("stays out of IME composition and dead keys", () => {
		expect(fileCaretAction(key("a", { isComposing: true }), true)).toEqual({
			kind: "passthrough",
		});
		expect(fileCaretAction(key("Dead", { altKey: true }), true)).toEqual({
			kind: "passthrough",
		});
		expect(fileCaretAction(key("Process"), false)).toEqual({
			kind: "passthrough",
		});
		expect(fileCaretAction(key("F5"), false)).toEqual({ kind: "passthrough" });
	});
});
