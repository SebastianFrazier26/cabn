import { describe, expect, test } from "vitest";
import {
	detectMac,
	type KeyLike,
	matchesBinding,
	parseBinding,
	SPELLBOOK_TOOLS,
	shortcutLabel,
	toolForKey,
	toolTooltip,
} from "../src/systems/spellbookTools.js";
import { createDefaultTools } from "../src/systems/tools.js";

function key(partial: Partial<KeyLike> & { key: string }): KeyLike {
	return {
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...partial,
	};
}

describe("spellbook tool table", () => {
	test("ids, labels and every binding are unique", () => {
		const ids = SPELLBOOK_TOOLS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		const bindings = SPELLBOOK_TOOLS.flatMap((t) => t.keys);
		expect(new Set(bindings).size).toBe(bindings.length);
	});

	test("every binding carries a modifier or is a function key, so none can collide with the world hotbar's bare-letter hotkeys", () => {
		const hotbarKeys = createDefaultTools().map((t) => t.hotkey.toLowerCase());
		for (const binding of SPELLBOOK_TOOLS.flatMap((t) => t.keys)) {
			const b = parseBinding(binding);
			const modified = b.mod || b.ctrl || b.alt;
			expect(modified || /^F\d+$/.test(b.key)).toBe(true);
			if (!modified) expect(hotbarKeys).not.toContain(b.key.toLowerCase());
		}
	});

	test("no binding shadows the bag's Alt+1-5 paste", () => {
		for (const digit of ["1", "2", "3", "4", "5"]) {
			const event = key({ key: digit, code: `Digit${digit}`, altKey: true });
			expect(toolForKey(event, true)).toBeUndefined();
			expect(toolForKey(event, false)).toBeUndefined();
		}
	});
});

describe("shortcutLabel / tooltip", () => {
	test("platform-specific modifier names", () => {
		expect(shortcutLabel("Mod-Shift-o", true)).toBe("Shift+Cmd+O");
		expect(shortcutLabel("Mod-Shift-o", false)).toBe("Ctrl+Shift+O");
		expect(shortcutLabel("Shift-Alt-f", true)).toBe("Shift+Option+F");
		expect(shortcutLabel("Ctrl-g", true)).toBe("Ctrl+G");
		expect(shortcutLabel("F2", false)).toBe("F2");
		expect(shortcutLabel("Mod-/", false)).toBe("Ctrl+/");
	});

	test("tooltip lists every binding", () => {
		const replace = SPELLBOOK_TOOLS.find((t) => t.id === "replace");
		expect(replace && toolTooltip(replace, true)).toContain(
			"Cmd+H / Option+Cmd+F",
		);
	});
});

describe("matchesBinding / toolForKey", () => {
	test("Mod means Cmd on mac and Ctrl elsewhere", () => {
		const cmdF = key({ key: "f", code: "KeyF", metaKey: true });
		const ctrlF = key({ key: "f", code: "KeyF", ctrlKey: true });
		expect(matchesBinding(cmdF, "Mod-f", true)).toBe(true);
		expect(matchesBinding(ctrlF, "Mod-f", true)).toBe(false);
		expect(matchesBinding(ctrlF, "Mod-f", false)).toBe(true);
	});

	test("matches on physical code when Option rewrites event.key", () => {
		const optShiftF = key({
			key: "Ï",
			code: "KeyF",
			altKey: true,
			shiftKey: true,
		});
		expect(toolForKey(optShiftF, true)?.id).toBe("format");
		const cmdOptF = key({
			key: "ƒ",
			code: "KeyF",
			altKey: true,
			metaKey: true,
		});
		expect(toolForKey(cmdOptF, true)?.id).toBe("replace");
	});

	test("resolves each tool's shortcut", () => {
		expect(toolForKey(key({ key: "F2" }), false)?.id).toBe("rename");
		expect(
			toolForKey(key({ key: "/", code: "Slash", ctrlKey: true }), false)?.id,
		).toBe("comment");
		expect(
			toolForKey(key({ key: "g", code: "KeyG", ctrlKey: true }), true)?.id,
		).toBe("goto");
		expect(
			toolForKey(
				key({ key: "O", code: "KeyO", metaKey: true, shiftKey: true }),
				true,
			)?.id,
		).toBe("symbol");
		expect(toolForKey(key({ key: "f", code: "KeyF" }), true)).toBeUndefined();
	});

	test("detectMac", () => {
		expect(detectMac("MacIntel")).toBe(true);
		expect(detectMac("Win32")).toBe(false);
		expect(detectMac(undefined)).toBe(false);
	});
});
