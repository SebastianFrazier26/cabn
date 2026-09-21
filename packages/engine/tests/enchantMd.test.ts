import { describe, expect, it } from "vitest";
import { enchantMdLine } from "../src/systems/enchantMd.js";

describe("enchantMdLine", () => {
	it("passes plain text through as a single plain segment", () => {
		const line = enchantMdLine("just some text");
		expect(line.headingLevel).toBeNull();
		expect(line.isListItem).toBe(false);
		expect(line.segments).toEqual([{ text: "just some text", style: "plain" }]);
	});

	it("detects h1/h2/h3 headings and strips the markers", () => {
		expect(enchantMdLine("# Title").headingLevel).toBe(1);
		expect(enchantMdLine("## Section").headingLevel).toBe(2);
		expect(enchantMdLine("### Sub").headingLevel).toBe(3);
		const h1 = enchantMdLine("# Title");
		expect(h1.segments).toEqual([{ text: "Title", style: "heading1" }]);
	});

	it("does not treat a bare # without a space as a heading", () => {
		expect(enchantMdLine("#not-a-heading").headingLevel).toBeNull();
	});

	it("detects -, *, +, and numbered list items", () => {
		for (const line of ["- item", "* item", "+ item", "1. item"]) {
			const parsed = enchantMdLine(line);
			expect(parsed.isListItem).toBe(true);
			expect(parsed.segments).toEqual([{ text: "item", style: "plain" }]);
		}
	});

	it("parses bold (** and __)", () => {
		expect(enchantMdLine("**bold**").segments).toEqual([
			{ text: "bold", style: "bold" },
		]);
		expect(enchantMdLine("__bold__").segments).toEqual([
			{ text: "bold", style: "bold" },
		]);
	});

	it("parses italic (* and _) without matching bold's double markers", () => {
		expect(enchantMdLine("*italic*").segments).toEqual([
			{ text: "italic", style: "italic" },
		]);
		expect(enchantMdLine("_italic_").segments).toEqual([
			{ text: "italic", style: "italic" },
		]);
	});

	it("parses combined bold+italic", () => {
		expect(enchantMdLine("***both***").segments).toEqual([
			{ text: "both", style: "boldItalic" },
		]);
	});

	it("parses inline code spans", () => {
		expect(enchantMdLine("`code()`").segments).toEqual([
			{ text: "code()", style: "code" },
		]);
	});

	it("parses links with text and href", () => {
		expect(enchantMdLine("[cabn](https://example.com)").segments).toEqual([
			{ text: "cabn", style: "link", href: "https://example.com" },
		]);
	});

	it("mixes plain text and inline styles on one line, preserving order", () => {
		const parsed = enchantMdLine("see **bold** and `code` here");
		expect(parsed.segments).toEqual([
			{ text: "see ", style: "plain" },
			{ text: "bold", style: "bold" },
			{ text: " and ", style: "plain" },
			{ text: "code", style: "code" },
			{ text: " here", style: "plain" },
		]);
	});

	it("still parses inline styles inside a heading's text", () => {
		const parsed = enchantMdLine("# Title with **bold**");
		expect(parsed.segments).toEqual([
			{ text: "Title with ", style: "heading1" },
			{ text: "bold", style: "bold" },
		]);
	});

	it("handles an empty heading line", () => {
		expect(enchantMdLine("#").headingLevel).toBeNull();
		expect(enchantMdLine("# ").segments).toEqual([
			{ text: "", style: "heading1" },
		]);
	});
});
