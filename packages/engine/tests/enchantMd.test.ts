import { describe, expect, it } from "vitest";
import { columnFromPaintedSpans } from "../src/systems/caretMotion.js";
import { enchantMdLine, type MdSegment } from "../src/systems/enchantMd.js";

/** Text/style/href only — source offsets have their own tests below. */
function shape(segments: MdSegment[]) {
	return segments.map(({ from: _from, to: _to, ...rest }) => rest);
}

describe("enchantMdLine", () => {
	it("passes plain text through as a single plain segment", () => {
		const line = enchantMdLine("just some text");
		expect(line.headingLevel).toBeNull();
		expect(line.isListItem).toBe(false);
		expect(shape(line.segments)).toEqual([
			{ text: "just some text", style: "plain" },
		]);
	});

	it("detects h1/h2/h3 headings and strips the markers", () => {
		expect(enchantMdLine("# Title").headingLevel).toBe(1);
		expect(enchantMdLine("## Section").headingLevel).toBe(2);
		expect(enchantMdLine("### Sub").headingLevel).toBe(3);
		const h1 = enchantMdLine("# Title");
		expect(shape(h1.segments)).toEqual([{ text: "Title", style: "heading1" }]);
	});

	it("does not treat a bare # without a space as a heading", () => {
		expect(enchantMdLine("#not-a-heading").headingLevel).toBeNull();
	});

	it("detects -, *, +, and numbered list items", () => {
		for (const line of ["- item", "* item", "+ item", "1. item"]) {
			const parsed = enchantMdLine(line);
			expect(parsed.isListItem).toBe(true);
			expect(shape(parsed.segments)).toEqual([
				{ text: "item", style: "plain" },
			]);
		}
	});

	it("parses bold (** and __)", () => {
		expect(shape(enchantMdLine("**bold**").segments)).toEqual([
			{ text: "bold", style: "bold" },
		]);
		expect(shape(enchantMdLine("__bold__").segments)).toEqual([
			{ text: "bold", style: "bold" },
		]);
	});

	it("parses italic (* and _) without matching bold's double markers", () => {
		expect(shape(enchantMdLine("*italic*").segments)).toEqual([
			{ text: "italic", style: "italic" },
		]);
		expect(shape(enchantMdLine("_italic_").segments)).toEqual([
			{ text: "italic", style: "italic" },
		]);
	});

	it("parses combined bold+italic", () => {
		expect(shape(enchantMdLine("***both***").segments)).toEqual([
			{ text: "both", style: "boldItalic" },
		]);
	});

	it("parses inline code spans", () => {
		expect(shape(enchantMdLine("`code()`").segments)).toEqual([
			{ text: "code()", style: "code" },
		]);
	});

	it("parses links with text and href", () => {
		expect(
			shape(enchantMdLine("[cabn](https://example.com)").segments),
		).toEqual([{ text: "cabn", style: "link", href: "https://example.com" }]);
	});

	it("keeps one level of balanced parens in a link target", () => {
		expect(
			shape(
				enchantMdLine("[w](https://en.wikipedia.org/wiki/Foo_(bar))").segments,
			),
		).toEqual([
			{
				text: "w",
				style: "link",
				href: "https://en.wikipedia.org/wiki/Foo_(bar)",
			},
		]);
	});

	it("does not link a target with an unbalanced paren", () => {
		const segments = enchantMdLine("[x](a(b)").segments;
		expect(segments.some((s) => s.style === "link")).toBe(false);
		expect(segments.map((s) => s.text).join("")).toBe("[x](a(b)");
	});

	it("links only the inner part of `[[x](u)`", () => {
		expect(shape(enchantMdLine("[[x](u)").segments)).toEqual([
			{ text: "[", style: "plain" },
			{ text: "x", style: "link", href: "u" },
		]);
	});

	it("mixes plain text and inline styles on one line, preserving order", () => {
		const parsed = enchantMdLine("see **bold** and `code` here");
		expect(shape(parsed.segments)).toEqual([
			{ text: "see ", style: "plain" },
			{ text: "bold", style: "bold" },
			{ text: " and ", style: "plain" },
			{ text: "code", style: "code" },
			{ text: " here", style: "plain" },
		]);
	});

	it("still parses inline styles inside a heading's text", () => {
		const parsed = enchantMdLine("# Title with **bold**");
		expect(shape(parsed.segments)).toEqual([
			{ text: "Title with ", style: "heading1" },
			{ text: "bold", style: "bold" },
		]);
	});

	it("handles an empty heading line", () => {
		expect(enchantMdLine("#").headingLevel).toBeNull();
		expect(shape(enchantMdLine("# ").segments)).toEqual([
			{ text: "", style: "heading1" },
		]);
	});

	it("records each segment's source offsets, skipping the hidden markup", () => {
		const offsets = (line: string) =>
			enchantMdLine(line).segments.map((s) => [
				line.slice(s.from, s.to),
				s.from,
			]);
		expect(offsets("see **bold** and `code` here")).toEqual([
			["see ", 0],
			["bold", 6],
			[" and ", 12],
			["code", 18],
			[" here", 23],
		]);
		expect(offsets("## Fields")).toEqual([["Fields", 3]]);
		expect(offsets("  - `crop` — plain")).toEqual([
			["crop", 5],
			[" — plain", 10],
		]);
		expect(offsets("***both*** [cabn](https://x.y) _i_")).toEqual([
			["both", 3],
			[" ", 10],
			["cabn", 12],
			[" ", 30],
			["i", 32],
		]);
		expect(offsets("a [w](https://x.y/Foo_(bar)) b")).toEqual([
			["a ", 0],
			["w", 3],
			[" b", 28],
		]);
		expect(enchantMdLine("# ").segments[0]).toMatchObject({ from: 2, to: 2 });
		expect(enchantMdLine("").segments[0]).toMatchObject({ from: 0, to: 0 });
	});
});

describe("caret mapping across a link whose target has parens", () => {
	it("maps clicks after the link to their source columns", () => {
		const line = "see [w](https://x.y/Foo_(bar)) then";
		const glyph = 8;
		const textX = 64;
		let x = textX;
		const spans = enchantMdLine(line).segments.map((s) => {
			const span = { x, width: s.text.length * glyph, from: s.from, to: s.to };
			x += span.width;
			return span;
		});
		const at = (painted: number) =>
			columnFromPaintedSpans(
				spans,
				textX + painted * glyph + 1,
				textX,
				line.length,
			);
		// Painted "see w then": the link text is the 5th glyph, "t" of "then" the 7th.
		expect(line[at(4)]).toBe("w");
		expect(at(4)).toBe(5);
		expect(line.slice(at(6))).toBe("then");
		expect(at(6)).toBe(31);
	});
});
