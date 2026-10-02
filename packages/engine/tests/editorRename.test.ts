import { javascriptLanguage } from "@codemirror/lang-javascript";
import { pythonLanguage } from "@codemirror/lang-python";
import { describe, expect, test } from "vitest";
import {
	applyRename,
	findOccurrences,
	isNonCodeNodeName,
	isValidIdentifier,
	nonCodeRanges,
	planRename,
	subtractRanges,
	wordAt,
} from "../src/systems/editorRename.js";

describe("findOccurrences", () => {
	test("matches whole identifiers only", () => {
		const text = "foo foobar my_foo foo$ $foo foo.x (foo)";
		const hits = findOccurrences(text, "foo");
		expect(hits.map((h) => text.slice(h.from, h.to))).toEqual([
			"foo",
			"foo",
			"foo",
		]);
		expect(hits.map((h) => h.from)).toEqual([0, 28, 35]);
	});

	test("reports 1-based line, 0-based column and the line text", () => {
		const text = "let a = 1;\n  a += a;\n";
		const hits = findOccurrences(text, "a");
		expect(hits.map((h) => [h.line, h.column])).toEqual([
			[1, 4],
			[2, 2],
			[2, 7],
		]);
		expect(hits[1]?.lineText).toBe("  a += a;");
	});

	test("skips matches that start inside excluded ranges", () => {
		const text = 'x = "x"; // x\nx';
		const excluded = [
			{ from: 4, to: 7 },
			{ from: 9, to: 13 },
		];
		expect(findOccurrences(text, "x", excluded).map((h) => h.from)).toEqual([
			0, 14,
		]);
	});

	test("css/html treat hyphens as part of the name", () => {
		const text = ".btn .btn-primary { --btn: 1 }";
		expect(findOccurrences(text, "btn", [], "css")).toHaveLength(1);
		expect(findOccurrences(text, "btn")).toHaveLength(3);
	});

	test("empty word finds nothing", () => {
		expect(findOccurrences("abc", "")).toEqual([]);
	});
});

describe("syntax-tree exclusion", () => {
	test("JS strings, comments and template text are excluded, interpolations are not", () => {
		const text = [
			"const name = 1;",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: JS source text under test
			'log("name", `name ${name}`); // name',
			"/* name */ name;",
		].join("\n");
		const tree = javascriptLanguage.parser.parse(text);
		const hits = findOccurrences(text, "name", nonCodeRanges(tree));
		expect(hits.map((h) => [h.line, h.column])).toEqual([
			[1, 6],
			[2, 20],
			[3, 11],
		]);
	});

	test("a string nested inside an interpolation stays excluded", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: JS source text under test
		const text = "`${f('v')} v`; v";
		const tree = javascriptLanguage.parser.parse(text);
		const hits = findOccurrences(text, "v", nonCodeRanges(tree));
		expect(hits.map((h) => h.from)).toEqual([text.length - 1]);
	});

	test("python strings and comments are excluded", () => {
		const text =
			'def total(xs):\n    # total of xs\n    return "total"\ntotal([1])';
		const tree = pythonLanguage.parser.parse(text);
		const hits = findOccurrences(text, "total", nonCodeRanges(tree));
		expect(hits.map((h) => h.line)).toEqual([1, 4]);
	});

	test("node-name classification", () => {
		expect(isNonCodeNodeName("String")).toBe(true);
		expect(isNonCodeNodeName("TemplateString")).toBe(true);
		expect(isNonCodeNodeName("LineComment")).toBe(true);
		expect(isNonCodeNodeName("VariableName")).toBe(false);
		expect(isNonCodeNodeName("Interpolation")).toBe(false);
	});

	test("subtractRanges carves holes", () => {
		expect(
			subtractRanges(
				[{ from: 0, to: 10 }],
				[
					{ from: 6, to: 8 },
					{ from: 2, to: 4 },
				],
			),
		).toEqual([
			{ from: 0, to: 2 },
			{ from: 4, to: 6 },
			{ from: 8, to: 10 },
		]);
		expect(subtractRanges([{ from: 3, to: 5 }], [{ from: 0, to: 9 }])).toEqual(
			[],
		);
	});
});

describe("wordAt / isValidIdentifier", () => {
	test("finds the identifier on either side of the caret", () => {
		expect(wordAt("let fooBar = 1", 6).word).toBe("fooBar");
		expect(wordAt("let fooBar = 1", 10).word).toBe("fooBar");
		expect(wordAt("let fooBar = 1", 11).word).toBe("");
	});

	test("validates names", () => {
		expect(isValidIdentifier("total_2")).toBe(true);
		expect(isValidIdentifier("2total")).toBe(false);
		expect(isValidIdentifier("a b")).toBe(false);
		expect(isValidIdentifier("")).toBe(false);
		expect(isValidIdentifier("btn-primary", "css")).toBe(true);
		expect(isValidIdentifier("btn-primary", "python")).toBe(false);
	});
});

describe("planRename / applyRename", () => {
	test("plans per target and applies a filtered selection", () => {
		const text = "a = a + obj.a";
		const plan = planRename(
			[{ path: "x.py", text, excluded: [] }],
			"a",
			"count",
		);
		expect(plan.files).toHaveLength(1);
		const occurrences = plan.files[0]?.occurrences ?? [];
		expect(occurrences).toHaveLength(3);
		// The preview lets the user untick the property access.
		expect(applyRename(text, occurrences.slice(0, 2), "count")).toBe(
			"count = count + obj.a",
		);
		expect(applyRename(text, occurrences, "b")).toBe("b = b + obj.b");
	});
});
