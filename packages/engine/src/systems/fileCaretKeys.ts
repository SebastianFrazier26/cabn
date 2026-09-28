import type { CaretMotion, DeleteMotion } from "./caretMotion.js";

/** The KeyboardEvent fields the file view's caret reads — structural so tests pass plain objects. */
export interface CaretKeyEvent {
	key: string;
	code: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	isComposing?: boolean;
}

export type FileCaretToolId = "bag" | "quill" | "wand" | "orb" | "spyglass";

export type FileCaretAction =
	| { kind: "move"; motion: CaretMotion; extend: boolean }
	| { kind: "insert"; text: string }
	| { kind: "newline" }
	| { kind: "indent" }
	| { kind: "dedent" }
	| { kind: "delete"; motion: DeleteMotion }
	| { kind: "undo" }
	| { kind: "redo" }
	| { kind: "save" }
	| { kind: "selectAll" }
	| { kind: "escape" }
	| { kind: "interact" }
	| { kind: "tool"; toolId: FileCaretToolId }
	| { kind: "pasteSlot"; index: number }
	/** Not ours: left to the browser (Cmd/Ctrl+C/X/V arrive as clipboard events, IME/dead keys as composition) or to another listener (the hotbar's Cmd/Ctrl+F). */
	| { kind: "passthrough" };

// The world's single-letter tool hotkeys (L/F/B/Q/R) would type into the
// file, so while the caret is writing they move to Alt+the same letter.
const ALT_TOOL_CODES: Record<string, FileCaretToolId> = {
	KeyB: "bag",
	KeyQ: "quill",
	KeyR: "wand",
	KeyF: "orb",
	KeyL: "spyglass",
};

const ALT_SLOT_CODES = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];

function isSingleChar(key: string): boolean {
	return [...key].length === 1;
}

function isAsciiNonLetter(key: string): boolean {
	return /^[\x20-\x7e]$/.test(key) && !/^[a-z]$/i.test(key);
}

/**
 * Keydown -> what the file view's inline caret does with it. Pure (the
 * platform is passed in) so every binding is unit-tested.
 *
 * Alt chords need care: on macOS, Option+letter *types* a character, and on
 * some layouts that character is one code needs (German Option+L is "@").
 * So Alt+B/Q/R/F/L is a tool only when it produces the plain letter
 * (Windows/Linux) or a non-ASCII symbol (US macOS "∫", "œ", "®"); when it
 * produces an ASCII symbol the layout wanted that symbol, and it's typed.
 * Ctrl+Alt together is AltGr on Windows, which also types.
 */
export function fileCaretAction(
	e: CaretKeyEvent,
	isMac: boolean,
): FileCaretAction {
	if (e.isComposing || e.key === "Process" || e.key === "Dead")
		return { kind: "passthrough" };
	const mod = isMac ? e.metaKey : e.ctrlKey;
	const extend = e.shiftKey;
	const wordMod = isMac ? e.altKey : e.ctrlKey;

	switch (e.key) {
		case "Escape":
			return { kind: "escape" };
		case "Enter":
			if (e.altKey && !mod) return { kind: "interact" };
			if (mod || e.ctrlKey || e.metaKey) return { kind: "passthrough" };
			return { kind: "newline" };
		case "Tab":
			if (mod || e.altKey || e.ctrlKey || e.metaKey)
				return { kind: "passthrough" };
			return e.shiftKey ? { kind: "dedent" } : { kind: "indent" };
		case "Backspace":
			if (isMac && e.metaKey) return { kind: "delete", motion: "lineStart" };
			return { kind: "delete", motion: wordMod ? "wordLeft" : "charLeft" };
		case "Delete":
			if (isMac && e.metaKey) return { kind: "delete", motion: "lineEnd" };
			return { kind: "delete", motion: wordMod ? "wordRight" : "charRight" };
		case "ArrowLeft":
			if (isMac && e.metaKey)
				return { kind: "move", motion: "lineStart", extend };
			return {
				kind: "move",
				motion: wordMod ? "wordLeft" : "charLeft",
				extend,
			};
		case "ArrowRight":
			if (isMac && e.metaKey)
				return { kind: "move", motion: "lineEnd", extend };
			return {
				kind: "move",
				motion: wordMod ? "wordRight" : "charRight",
				extend,
			};
		case "ArrowUp":
			if (isMac && e.metaKey)
				return { kind: "move", motion: "docStart", extend };
			return { kind: "move", motion: "lineUp", extend };
		case "ArrowDown":
			if (isMac && e.metaKey) return { kind: "move", motion: "docEnd", extend };
			return { kind: "move", motion: "lineDown", extend };
		case "Home":
			return { kind: "move", motion: mod ? "docStart" : "lineStart", extend };
		case "End":
			return { kind: "move", motion: mod ? "docEnd" : "lineEnd", extend };
		case "PageUp":
			return { kind: "move", motion: "pageUp", extend };
		case "PageDown":
			return { kind: "move", motion: "pageDown", extend };
	}

	if (mod && !e.altKey) {
		const k = e.key.toLowerCase();
		if (k === "z") return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
		if (k === "y" && !isMac) return { kind: "redo" };
		if (k === "s") return { kind: "save" };
		if (k === "a") return { kind: "selectAll" };
		return { kind: "passthrough" };
	}

	if (e.altKey && !e.ctrlKey && !e.metaKey) {
		const slot = ALT_SLOT_CODES.indexOf(e.code);
		if (slot !== -1) return { kind: "pasteSlot", index: slot };
		const tool = ALT_TOOL_CODES[e.code];
		if (tool && !isAsciiNonLetter(e.key)) return { kind: "tool", toolId: tool };
		if (isSingleChar(e.key)) return { kind: "insert", text: e.key };
		return { kind: "passthrough" };
	}

	if (e.ctrlKey && e.altKey && isSingleChar(e.key))
		return { kind: "insert", text: e.key };
	if (e.ctrlKey || e.metaKey) return { kind: "passthrough" };
	if (isSingleChar(e.key)) return { kind: "insert", text: e.key };
	return { kind: "passthrough" };
}
