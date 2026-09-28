import { describe, expect, it } from "vitest";
import {
	activeFocusOwner,
	classifyFocus,
	type FocusCandidate,
} from "../src/systems/uiFocus.js";

function el(
	tagName: string,
	extra: Partial<FocusCandidate> = {},
	attrs: Record<string, string> = {},
): FocusCandidate {
	return {
		tagName,
		getAttribute: (name) => attrs[name] ?? null,
		...extra,
	};
}

describe("classifyFocus", () => {
	it("is none for nothing focused, body, or the game canvas", () => {
		expect(classifyFocus(null)).toBe("none");
		expect(classifyFocus(undefined)).toBe("none");
		expect(classifyFocus(el("BODY"))).toBe("none");
		expect(classifyFocus(el("CANVAS"))).toBe("none");
	});

	it("treats text inputs, textareas and selects as text", () => {
		expect(classifyFocus(el("INPUT", { type: "text" }))).toBe("text");
		expect(classifyFocus(el("INPUT", { type: "search" }))).toBe("text");
		expect(classifyFocus(el("INPUT"))).toBe("text");
		expect(classifyFocus(el("TEXTAREA"))).toBe("text");
		expect(classifyFocus(el("SELECT"))).toBe("text");
	});

	it("treats a contenteditable element (CodeMirror's content div) as text", () => {
		expect(classifyFocus(el("DIV", { isContentEditable: true }))).toBe("text");
	});

	it("treats buttons and button-like inputs as controls", () => {
		expect(classifyFocus(el("BUTTON"))).toBe("control");
		expect(classifyFocus(el("INPUT", { type: "checkbox" }))).toBe("control");
		expect(classifyFocus(el("INPUT", { type: "submit" }))).toBe("control");
		expect(classifyFocus(el("DIV", {}, { role: "button" }))).toBe("control");
	});

	it("only counts a link as a control when it has an href", () => {
		expect(classifyFocus(el("A", {}, { href: "#x" }))).toBe("control");
		expect(classifyFocus(el("A"))).toBe("none");
	});

	it("honours an ARIA textbox role", () => {
		expect(classifyFocus(el("DIV", {}, { role: "textbox" }))).toBe("text");
	});

	it("is case-insensitive on tag names", () => {
		expect(classifyFocus(el("input", { type: "TEXT" }))).toBe("text");
	});
});

describe("activeFocusOwner", () => {
	it("is none without a DOM", () => {
		expect(activeFocusOwner()).toBe("none");
	});
});
