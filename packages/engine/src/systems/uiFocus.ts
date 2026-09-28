/**
 * Who owns the keyboard right now, judged from the DOM's focused element:
 * - "text": a text field or editor (orb search input, CodeMirror), or a
 *   focused iframe (the docked live web page). Every key belongs to it; the
 *   game must not see any of them.
 * - "control": a focused button/link. The game can keep walking on WASD, but
 *   Enter/Space also activate the control natively, so world interaction on
 *   Enter would double-fire.
 * - "none": nothing interactive is focused (body, the canvas).
 */
export type FocusOwner = "text" | "control" | "none";

/** The slice of an Element this needs — structural so tests can pass plain objects instead of a DOM. */
export interface FocusCandidate {
	tagName?: string;
	isContentEditable?: boolean;
	type?: string;
	getAttribute?(name: string): string | null;
}

const NON_TEXT_INPUT_TYPES = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

export function classifyFocus(
	el: FocusCandidate | null | undefined,
): FocusOwner {
	if (!el) return "none";
	if (el.isContentEditable) return "text";
	const tag = (el.tagName ?? "").toUpperCase();
	if (tag === "TEXTAREA" || tag === "SELECT") return "text";
	// Keys typed while a cross-origin page has focus never reach this window,
	// so a key held when focus moved in would miss its keyup; treating the
	// frame as a text owner makes the focus gate reset held keys on the way in.
	if (tag === "IFRAME") return "text";
	if (tag === "INPUT") {
		const type = (el.type ?? "text").toLowerCase();
		return NON_TEXT_INPUT_TYPES.has(type) ? "control" : "text";
	}
	if (tag === "BUTTON" || tag === "SUMMARY") return "control";
	if (tag === "A" && el.getAttribute?.("href") != null) return "control";
	const role = el.getAttribute?.("role");
	if (role === "button" || role === "link" || role === "menuitem")
		return "control";
	if (role === "textbox" || role === "searchbox") return "text";
	return "none";
}

/** Live read of `document.activeElement` — `"none"` outside a browser (Vitest's node environment, SSR). */
export function activeFocusOwner(): FocusOwner {
	if (typeof document === "undefined") return "none";
	return classifyFocus(document.activeElement as FocusCandidate | null);
}
