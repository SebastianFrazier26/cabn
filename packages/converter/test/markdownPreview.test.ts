import { MARKDOWN_PREVIEW_MAX_NODES } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { markdownToStructuredPreview } from "../src/markdownPreview.js";

describe("markdownToStructuredPreview", () => {
	test("parses a heading", () => {
		const result = markdownToStructuredPreview("# Title\n");
		expect(result.nodes).toEqual([
			{ type: "heading", level: 1, text: "Title" },
		]);
		expect(result.truncated).toBe(false);
	});

	test("parses heading levels 1-6", () => {
		const result = markdownToStructuredPreview("###### Deep\n");
		expect(result.nodes).toEqual([{ type: "heading", level: 6, text: "Deep" }]);
	});

	test("collapses consecutive lines into one paragraph", () => {
		const result = markdownToStructuredPreview(
			"Hello\nworld.\n\nNext paragraph.",
		);
		expect(result.nodes).toEqual([
			{ type: "paragraph", text: "Hello world." },
			{ type: "paragraph", text: "Next paragraph." },
		]);
	});

	test("groups consecutive bullet items into one unordered list", () => {
		const result = markdownToStructuredPreview("- a\n- b\n- c\n");
		expect(result.nodes).toEqual([
			{ type: "list", ordered: false, items: ["a", "b", "c"] },
		]);
	});

	test("groups consecutive numbered items into one ordered list", () => {
		const result = markdownToStructuredPreview("1. a\n2. b\n");
		expect(result.nodes).toEqual([
			{ type: "list", ordered: true, items: ["a", "b"] },
		]);
	});

	test("starts a new list node when switching between ordered and unordered", () => {
		const result = markdownToStructuredPreview("- a\n1. b\n");
		expect(result.nodes).toEqual([
			{ type: "list", ordered: false, items: ["a"] },
			{ type: "list", ordered: true, items: ["b"] },
		]);
	});

	test("parses a fenced code block with a language tag", () => {
		const result = markdownToStructuredPreview("```ts\nconst x = 1;\n```\n");
		expect(result.nodes).toEqual([
			{ type: "code", language: "ts", text: "const x = 1;" },
		]);
	});

	test("parses a fenced code block with no language tag", () => {
		const result = markdownToStructuredPreview("```\nplain\n```\n");
		expect(result.nodes).toEqual([
			{ type: "code", language: undefined, text: "plain" },
		]);
	});

	test("handles a realistic README shape", () => {
		const md = [
			"# mini-python",
			"",
			"A tiny fixture package.",
			"",
			"## Usage",
			"",
			"- one",
			"- two",
			"",
			"```py",
			"print('hi')",
			"```",
		].join("\n");

		const result = markdownToStructuredPreview(md);
		expect(result.nodes).toEqual([
			{ type: "heading", level: 1, text: "mini-python" },
			{ type: "paragraph", text: "A tiny fixture package." },
			{ type: "heading", level: 2, text: "Usage" },
			{ type: "list", ordered: false, items: ["one", "two"] },
			{ type: "code", language: "py", text: "print('hi')" },
		]);
		expect(result.truncated).toBe(false);
	});

	test("marks truncated once the node cap is hit", () => {
		const md = Array.from(
			{ length: MARKDOWN_PREVIEW_MAX_NODES + 5 },
			(_, i) => `# Heading ${i}`,
		).join("\n\n");

		const result = markdownToStructuredPreview(md);
		expect(result.nodes).toHaveLength(MARKDOWN_PREVIEW_MAX_NODES);
		expect(result.truncated).toBe(true);
	});

	test("truncates an overlong paragraph and marks truncated", () => {
		const longWord = "x".repeat(500);
		const result = markdownToStructuredPreview(longWord);
		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0]?.type).toBe("paragraph");
		expect(result.truncated).toBe(true);
	});

	test("returns no nodes for empty content", () => {
		const result = markdownToStructuredPreview("");
		expect(result.nodes).toEqual([]);
		expect(result.truncated).toBe(false);
	});

	test("closes an unterminated fenced code block at end of file", () => {
		const result = markdownToStructuredPreview("```js\nconst a = 1;");
		expect(result.nodes).toEqual([
			{ type: "code", language: "js", text: "const a = 1;" },
		]);
	});
});
