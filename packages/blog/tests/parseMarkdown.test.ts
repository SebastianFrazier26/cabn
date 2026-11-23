import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeUrl } from "../src/parseMarkdown.js";

describe("safeUrl", () => {
	it.each([
		["https://example.com/a", "https://example.com/a"],
		["http://example.com", "http://example.com/"],
		["/blog/hello/", "/blog/hello/"],
		["/img/a.png", "/img/a.png"],
	])("keeps %j", (raw, out) => {
		expect(safeUrl(raw)).toBe(out);
	});

	it.each([
		"javascript:alert(1)",
		"data:text/html,x",
		"//evil.example",
		"/\\evil.example",
		"relative/path",
		"mailto:a@b.c",
		"",
		" ",
	])("drops %j", (raw) => {
		expect(safeUrl(raw)).toBeNull();
	});
});

describe("parseInline", () => {
	it("parses strong, em, code and links", () => {
		expect(parseInline("a **b** *c* `d` [e](https://x.dev/)")).toEqual([
			{ kind: "text", text: "a " },
			{ kind: "strong", children: [{ kind: "text", text: "b" }] },
			{ kind: "text", text: " " },
			{ kind: "em", children: [{ kind: "text", text: "c" }] },
			{ kind: "text", text: " " },
			{ kind: "code", text: "d" },
			{ kind: "text", text: " " },
			{ kind: "link", text: "e", href: "https://x.dev/", external: true },
		]);
	});

	it("marks site-relative links as internal", () => {
		expect(parseInline("[next](/blog/next/)")).toEqual([
			{ kind: "link", text: "next", href: "/blog/next/", external: false },
		]);
	});

	it("renders an unsafe link as its text", () => {
		expect(parseInline("[x](javascript:alert(1))")).toEqual([
			{ kind: "text", text: "x)" },
		]);
	});

	it("leaves raw HTML as text", () => {
		expect(parseInline("<script>alert(1)</script>")).toEqual([
			{ kind: "text", text: "<script>alert(1)</script>" },
		]);
	});

	it("does not treat snake_case as emphasis", () => {
		expect(parseInline("a snake_case_name")).toEqual([
			{ kind: "text", text: "a snake_case_name" },
		]);
	});
});

describe("parseMarkdown", () => {
	it("parses headings, paragraphs, lists and fenced code", () => {
		const blocks = parseMarkdown(
			[
				"# Title",
				"",
				"One",
				"two.",
				"",
				"- a",
				"- b",
				"",
				"1. x",
				"",
				"```ts",
				"const a = 1;",
				"```",
			].join("\n"),
		);
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"paragraph",
			"list",
			"list",
			"code",
		]);
		expect(blocks[0]).toMatchObject({ level: 1 });
		expect(blocks[1]).toEqual({
			kind: "paragraph",
			inline: [{ kind: "text", text: "One two." }],
		});
		expect(blocks[2]).toMatchObject({ ordered: false });
		expect(blocks[3]).toMatchObject({ ordered: true });
		expect(blocks[4]).toEqual({
			kind: "code",
			lang: "ts",
			text: "const a = 1;",
		});
	});

	it("parses a blockquote into paragraphs", () => {
		expect(parseMarkdown("> one\n> two\n>\n> three")).toEqual([
			{
				kind: "quote",
				paragraphs: [
					[{ kind: "text", text: "one two" }],
					[{ kind: "text", text: "three" }],
				],
			},
		]);
	});

	it("parses a standalone image and a rule", () => {
		expect(parseMarkdown("![A chart](/img/chart.png)\n\n---")).toEqual([
			{ kind: "image", alt: "A chart", src: "/img/chart.png" },
			{ kind: "rule" },
		]);
	});

	it("turns an image with an unsafe source into its alt text", () => {
		expect(parseMarkdown("![x](data:image/png;base64,AAAA)")).toEqual([
			{ kind: "paragraph", inline: [{ kind: "text", text: "x" }] },
		]);
	});

	it("keeps an unclosed fence as code to the end", () => {
		expect(parseMarkdown("```\na\nb")).toEqual([
			{ kind: "code", lang: "", text: "a\nb" },
		]);
	});

	it("drops a non-word fence language", () => {
		expect(parseMarkdown('```"><x\na\n```')[0]).toMatchObject({ lang: "" });
	});

	it("normalises CRLF", () => {
		expect(parseMarkdown("a\r\n\r\nb")).toHaveLength(2);
	});

	it("extracts no title-less surprises from an empty source", () => {
		expect(parseMarkdown("")).toEqual([]);
	});
});
