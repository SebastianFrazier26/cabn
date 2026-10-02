/**
 * The spellbook's labeled toolbar, as data: which tools exist, their label,
 * icon and keybinds. Bindings use CodeMirror's key notation ("Mod" = Cmd on
 * macOS, Ctrl elsewhere) so the same strings feed both the CM keymap and the
 * window-level fallback matcher below, and the tooltip text is derived from
 * them rather than typed a second time.
 */
export type SpellbookToolId =
	| "run"
	| "save"
	| "find"
	| "replace"
	| "rename"
	| "format"
	| "comment"
	| "goto"
	| "symbol"
	| "foldAll"
	| "unfoldAll";

export type SpellbookToolIcon =
	| "wand"
	| "save"
	| "find"
	| "replace"
	| "rename"
	| "format"
	| "comment"
	| "goto"
	| "symbol"
	| "fold"
	| "unfold";

export interface SpellbookTool {
	id: SpellbookToolId;
	label: string;
	/** Longer tooltip lead-in; the shortcut is appended by `toolTooltip`. */
	hint: string;
	icon: SpellbookToolIcon;
	/** First entry is the one shown in the tooltip. */
	keys: readonly string[];
}

export const SPELLBOOK_TOOLS: readonly SpellbookTool[] = [
	{
		id: "run",
		label: "Run",
		hint: "Cast (run) this file",
		icon: "wand",
		keys: ["Mod-Enter"],
	},
	{
		id: "save",
		label: "Save",
		hint: "Seal (save) the file",
		icon: "save",
		keys: ["Mod-s"],
	},
	{
		id: "find",
		label: "Find",
		hint: "Find in file",
		icon: "find",
		keys: ["Mod-f"],
	},
	{
		id: "replace",
		label: "Replace",
		hint: "Find & replace (regex toggle in the panel)",
		icon: "replace",
		// Cmd+H hides the whole browser on macOS before the page ever sees it,
		// so Alt+Cmd+F (VS Code's mac binding) is the one that actually works there.
		keys: ["Mod-h", "Mod-Alt-f"],
	},
	{
		id: "rename",
		label: "Rename",
		hint: "Rename symbol in this file",
		icon: "rename",
		keys: ["F2"],
	},
	{
		id: "format",
		label: "Format",
		hint: "Format document",
		icon: "format",
		keys: ["Shift-Alt-f"],
	},
	{
		id: "comment",
		label: "Comment",
		hint: "Toggle line comment",
		icon: "comment",
		keys: ["Mod-/"],
	},
	{
		id: "goto",
		label: "Go to line",
		hint: "Go to line[:column]",
		icon: "goto",
		keys: ["Ctrl-g"],
	},
	{
		id: "symbol",
		label: "Symbol",
		hint: "Go to symbol in file",
		icon: "symbol",
		keys: ["Mod-Shift-o"],
	},
	{
		id: "foldAll",
		label: "Fold all",
		hint: "Fold every block",
		icon: "fold",
		keys: ["Ctrl-Alt-["],
	},
	{
		id: "unfoldAll",
		label: "Unfold",
		hint: "Unfold every block",
		icon: "unfold",
		keys: ["Ctrl-Alt-]"],
	},
];

export interface ParsedBinding {
	key: string;
	mod: boolean;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
}

export function parseBinding(binding: string): ParsedBinding {
	// Split on "-" but keep a literal trailing "-" key usable.
	const parts = binding.split(/-(?!$)/);
	const key = parts.pop() ?? "";
	const has = (m: string) => parts.includes(m);
	return {
		key,
		mod: has("Mod"),
		ctrl: has("Ctrl"),
		alt: has("Alt"),
		shift: has("Shift"),
	};
}

const MAC_SYMBOLS: Record<string, string> = {
	Mod: "Cmd",
	Ctrl: "Ctrl",
	Alt: "Option",
	Shift: "Shift",
};

function displayKey(key: string): string {
	if (key.length === 1) return key.toUpperCase();
	return key;
}

/** "Mod-Shift-o" -> "Cmd+Shift+O" on macOS, "Ctrl+Shift+O" elsewhere. */
export function shortcutLabel(binding: string, isMac: boolean): string {
	const b = parseBinding(binding);
	const mods: string[] = [];
	if (b.ctrl || (b.mod && !isMac)) mods.push("Ctrl");
	if (b.shift) mods.push("Shift");
	if (b.alt) mods.push(isMac ? (MAC_SYMBOLS.Alt as string) : "Alt");
	if (b.mod && isMac) mods.push("Cmd");
	return [...mods, displayKey(b.key)].join("+");
}

export function toolTooltip(tool: SpellbookTool, isMac: boolean): string {
	const keys = tool.keys.map((k) => shortcutLabel(k, isMac)).join(" / ");
	return `${tool.hint} (${keys})`;
}

/** The KeyboardEvent slice the matcher reads — structural for tests. */
export interface KeyLike {
	key: string;
	code?: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

// Option/Shift change `event.key` on macOS (Option+F is "ƒ", Shift+/ is "?"),
// so letters, digits and punctuation match on the physical `code` instead.
const CODE_FOR_KEY: Record<string, string> = {
	"/": "Slash",
	"[": "BracketLeft",
	"]": "BracketRight",
};

function keyMatches(event: KeyLike, key: string): boolean {
	if (key.length === 1) {
		const lower = key.toLowerCase();
		if (/[a-z]/.test(lower)) {
			return event.code
				? event.code === `Key${lower.toUpperCase()}`
				: event.key.toLowerCase() === lower;
		}
		if (/[0-9]/.test(lower)) {
			return event.code ? event.code === `Digit${lower}` : event.key === lower;
		}
		const code = CODE_FOR_KEY[key];
		return code && event.code ? event.code === code : event.key === key;
	}
	return event.key === key;
}

export function matchesBinding(
	event: KeyLike,
	binding: string,
	isMac: boolean,
): boolean {
	const b = parseBinding(binding);
	const wantMeta = b.mod && isMac;
	const wantCtrl = b.ctrl || (b.mod && !isMac);
	return (
		event.metaKey === wantMeta &&
		event.ctrlKey === wantCtrl &&
		event.altKey === b.alt &&
		event.shiftKey === b.shift &&
		keyMatches(event, b.key)
	);
}

export function toolForKey(
	event: KeyLike,
	isMac: boolean,
	tools: readonly SpellbookTool[] = SPELLBOOK_TOOLS,
): SpellbookTool | undefined {
	return tools.find((t) => t.keys.some((k) => matchesBinding(event, k, isMac)));
}

export function detectMac(platform: string | undefined): boolean {
	return /Mac|iPhone|iPad|iPod/i.test(platform ?? "");
}
