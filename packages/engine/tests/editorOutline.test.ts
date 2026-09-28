import { describe, expect, test } from "vitest";
import {
	filterSymbols,
	indentationFoldEnd,
	outlineSymbols,
	parseGoToLine,
} from "../src/systems/editorOutline.js";

const pick = (s: { name: string; kind: string; line: number }) => [
	s.name,
	s.kind,
	s.line,
];

describe("outlineSymbols", () => {
	test("javascript/typescript definitions", () => {
		const text = [
			"import x from 'y';",
			"export async function load(a) {",
			"  if (a) {",
			"  }",
			"}",
			"export default class Store {",
			"  private get size(): number {",
			"  }",
			"}",
			"const add = (a, b) => a + b;",
			"export const LIMIT = 3;",
			"interface Props {}",
			"// function commented() {}",
		].join("\n");
		expect(outlineSymbols(text, "typescript").map(pick)).toEqual([
			["load", "function", 1],
			["Store", "class", 5],
			["size", "method", 6],
			["add", "function", 9],
			["LIMIT", "variable", 10],
			["Props", "type", 11],
		]);
	});

	test("python defs, classes and constants, ignoring comments", () => {
		const text =
			"MAX = 3\nclass Bag:\n    def add(self):\n        pass\n# def nope():\n";
		const symbols = outlineSymbols(text, "python");
		expect(symbols.map(pick)).toEqual([
			["MAX", "variable", 0],
			["Bag", "class", 1],
			["add", "function", 2],
		]);
		expect(symbols[2]?.depth).toBe(4);
	});

	test("markdown headings skip fenced code", () => {
		const text = "# Title\ntext\n## Part two ##\n```\n# not a heading\n```\n";
		const symbols = outlineSymbols(text, "markdown");
		expect(symbols.map(pick)).toEqual([
			["Title", "heading", 0],
			["Part two", "heading", 2],
		]);
		expect(symbols[1]?.depth).toBe(1);
	});

	test("css selectors and at-rules", () => {
		const text =
			".btn {\n  color: red;\n}\n@media (max-width: 1px) {\n  #id a {}\n}";
		expect(outlineSymbols(text, "css").map((s) => s.name)).toEqual([
			".btn",
			"@media (max-width: 1px)",
			"#id a",
		]);
	});

	test("plain-text files fall back to cross-language patterns", () => {
		const text = "pub fn run() {}\nstruct Point {}\nfunc main() {}";
		expect(outlineSymbols(text, "rust").map((s) => s.name)).toEqual([
			"run",
			"Point",
			"main",
		]);
	});
});

describe("filterSymbols", () => {
	const symbols = outlineSymbols(
		"function getLine() {}\nfunction toggle() {}\nfunction lineCount() {}",
		"javascript",
	);

	test("empty query keeps document order", () => {
		expect(filterSymbols(symbols, " ").map((s) => s.name)).toEqual([
			"getLine",
			"toggle",
			"lineCount",
		]);
	});

	test("substring matches rank before subsequence matches", () => {
		expect(filterSymbols(symbols, "line").map((s) => s.name)).toEqual([
			"lineCount",
			"getLine",
		]);
		expect(filterSymbols(symbols, "gtl").map((s) => s.name)).toEqual([
			"getLine",
		]);
	});
});

describe("indentationFoldEnd", () => {
	const lines = ["root:", "  a: 1", "", "  b:", "    c: 2", "", "next: 3"];
	test("folds the deeper-indented run, skipping trailing blanks", () => {
		expect(indentationFoldEnd(lines, 0)).toBe(4);
		expect(indentationFoldEnd(lines, 3)).toBe(4);
	});
	test("no fold for leaf or blank lines", () => {
		expect(indentationFoldEnd(lines, 1)).toBeNull();
		expect(indentationFoldEnd(lines, 2)).toBeNull();
		expect(indentationFoldEnd(lines, 6)).toBeNull();
	});
});

describe("parseGoToLine", () => {
	test("parses and clamps", () => {
		expect(parseGoToLine("3", 10)).toEqual({ line: 2, column: 0 });
		expect(parseGoToLine(" 4:7 ", 10)).toEqual({ line: 3, column: 6 });
		expect(parseGoToLine("99", 10)).toEqual({ line: 9, column: 0 });
		expect(parseGoToLine("0", 10)).toEqual({ line: 0, column: 0 });
		expect(parseGoToLine("abc", 10)).toBeNull();
		expect(parseGoToLine("", 10)).toBeNull();
	});
});
