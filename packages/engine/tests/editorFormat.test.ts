import { describe, expect, test } from "vitest";
import {
	applyLineChanges,
	defaultFormatOptions,
	detectIndentUnit,
	formatText,
	lineChanges,
	linesEndingInside,
	shouldReindent,
} from "../src/systems/editorFormat.js";

describe("formatText", () => {
	test("trims trailing whitespace and adds a final newline", () => {
		expect(formatText("a  \n\tb\t\nc", defaultFormatOptions("python"))).toBe(
			"a\n\tb\nc\n",
		);
	});

	test("leaves an existing final newline and an empty doc alone", () => {
		const opts = defaultFormatOptions("javascript");
		expect(formatText("x\n", opts)).toBe("x\n");
		expect(formatText("", opts)).toBe("");
	});

	test("markdown keeps its two-space hard breaks", () => {
		expect(
			formatText("line one  \nline two", defaultFormatOptions("markdown")),
		).toBe("line one  \nline two\n");
	});

	test("protected lines keep their trailing whitespace", () => {
		expect(
			formatText("a  \nb  \nc  ", {
				trimTrailingWhitespace: true,
				ensureFinalNewline: false,
				protectedLines: new Set([1]),
			}),
		).toBe("a\nb  \nc");
	});
});

describe("detectIndentUnit / shouldReindent", () => {
	test("learns the file's own step", () => {
		expect(detectIndentUnit("def f():\n    if x:\n        y\n    z\n")).toBe(
			"    ",
		);
		expect(detectIndentUnit("a {\n  b {\n    c\n  }\n}\n")).toBe("  ");
		expect(detectIndentUnit("a {\n\tb\n\t\tc\n}\n")).toBe("\t");
		expect(detectIndentUnit("flat\nfile\n")).toBe("  ");
	});

	test("indentation-sensitive languages are never re-indented", () => {
		expect(shouldReindent("python")).toBe(false);
		expect(shouldReindent("yaml")).toBe(false);
		expect(shouldReindent("markdown")).toBe(false);
		expect(shouldReindent("typescript")).toBe(true);
		expect(shouldReindent(undefined)).toBe(true);
	});
});

describe("linesEndingInside", () => {
	test("flags lines whose newline sits inside a range", () => {
		const text = "const s = `a  \nb  \nc`;\nx  ";
		const start = text.indexOf("`");
		const end = text.lastIndexOf("`") + 1;
		expect([...linesEndingInside(text, [{ from: start, to: end }])]).toEqual([
			0, 1,
		]);
	});
});

describe("lineChanges", () => {
	test("round-trips indentation and whitespace edits", () => {
		const before = "if (x) {\nfoo();  \n    bar();\n}";
		const after = "if (x) {\n  foo();\n  bar();\n}\n";
		const changes = lineChanges(before, after);
		expect(applyLineChanges(before, changes)).toBe(after);
		// Only the changed spans are touched, not whole lines.
		expect(changes).toEqual([
			{ from: 9, to: 9, insert: "  " },
			{ from: 15, to: 17, insert: "" },
			{ from: 20, to: 22, insert: "" },
			{ from: 30, to: 30, insert: "\n" },
		]);
	});

	test("no changes for identical text", () => {
		expect(lineChanges("a\nb", "a\nb")).toEqual([]);
	});

	test("handles removed trailing lines", () => {
		const before = "a\nb\nc";
		expect(applyLineChanges(before, lineChanges(before, "a"))).toBe("a");
	});
});
