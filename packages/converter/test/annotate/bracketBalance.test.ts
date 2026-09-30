import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { bracketBalance } from "../../src/annotate/bracketBalance.js";
import { classify } from "../../src/classify.js";

function file(path: string): PortalFile {
	const info = classify(path);
	return {
		path,
		name: path.split("/").pop() ?? path,
		kind: info.kind,
		language: info.language,
		bytes: 0,
		binary: false,
	};
}

function run(path: string, content: string) {
	return bracketBalance({
		file: file(path),
		content,
		worldFiles: new Set([path]),
	});
}

describe("bracketBalance", () => {
	test("flags an unclosed paren (a plain trailing opener, no closer of any kind after it)", () => {
		const results = run("a.ts", "const x = (1 + 2\n");
		expect(results.some((r) => r.rule.startsWith("bracket:unclosed:("))).toBe(
			true,
		);
		expect(results[0]).toMatchObject({ code: "IoError", species: "gremlin" });
	});

	test("an opener closed by the wrong bracket type is reported as mismatched, not unclosed", () => {
		const results = run("a.ts", "function f() {\n  return (1 + 2;\n}\n");
		expect(results.some((r) => r.rule.startsWith("bracket:mismatched:("))).toBe(
			true,
		);
	});

	test("flags a mismatched bracket", () => {
		const results = run("a.ts", "const x = [1, 2, 3);\n");
		expect(results.some((r) => r.rule.startsWith("bracket:mismatched:["))).toBe(
			true,
		);
	});

	test("flags an unexpected closing bracket", () => {
		const results = run("a.ts", "function f() {}\n}\n");
		expect(
			results.some((r) => r.rule.startsWith("bracket:unexpected-close:}")),
		).toBe(true);
	});

	test("balanced code produces no issues", () => {
		expect(
			run("a.ts", "function f(a, b) {\n  return [a, { b }];\n}\n"),
		).toHaveLength(0);
	});

	test("does not flag a bracket inside a line comment", () => {
		expect(run("a.ts", "// this ( is fine\nfunction f() {}\n")).toHaveLength(0);
	});

	test("does not flag a bracket inside a block comment", () => {
		expect(
			run("a.ts", "/* ( [ { unbalanced inside a comment */\nconst x = 1;\n"),
		).toHaveLength(0);
	});

	test("does not flag a bracket inside a string literal", () => {
		expect(
			run("a.ts", 'const s = "(not a bracket";\nconst n = 1;\n'),
		).toHaveLength(0);
	});

	test("flags an unterminated single-line string", () => {
		const results = run("a.ts", 'const s = "never closed;\n');
		expect(
			results.some((r) => r.rule.startsWith("bracket:unterminated-string")),
		).toBe(true);
	});

	test("handles Python triple-quoted strings without false positives", () => {
		const content =
			'"""\ndocstring with ( [ { unbalanced\n"""\ndef f():\n    return (1, 2)\n';
		expect(run("a.py", content)).toHaveLength(0);
	});

	test("Python: flags a real unclosed bracket outside any string", () => {
		const results = run("a.py", "def f():\n    return (1, 2\n");
		expect(results.some((r) => r.rule.startsWith("bracket:unclosed:("))).toBe(
			true,
		);
	});

	test("handles a multi-line backtick template literal without cascading (regression: changesets/changesets get-changelog-entry.test.ts shape)", () => {
		// Real shape from the wide-pass report: a multi-line backtick containing
		// markdown with nested single/double quotes used to be read as
		// "unterminated" at its first newline, dumping the rest of the file
		// back into normal-code scanning and cascading into ~1000 bogus issues
		// from one 74-line file — see docs/testing/2026-09-29-wide-pass.md,
		// Bug 3.
		const content = [
			'test("formats a changelog entry", () => {',
			"  expect(entry).toMatchInlineSnapshot(`",
			'    - Adds a "feature" flag',
			"    - Fixes 'a bug' in the release plan",
			"    - See [notes](./notes.md) for details",
			"  `);",
			"});",
			"",
		].join("\n");
		expect(run("get-changelog-entry.test.ts", content)).toHaveLength(0);
	});

	test("tracks a template literal's interpolation, including a nested template", () => {
		const content =
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
			"const s = `outer ${`inner ${x + 1}`} tail ${[1, 2, { a: 1 }]}`;\n";
		expect(run("a.ts", content)).toHaveLength(0);
	});

	test("does not treat an escaped backtick or an escaped interpolation-opener as ending/opening template content", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
		const content = "const s = `a \\` b \\${notInterp} c`;\n";
		expect(run("a.ts", content)).toHaveLength(0);
	});

	test("still catches a real unclosed bracket after a template literal", () => {
		const content =
			"const s = `multi\nline`;\nfunction f(a, b {\n  return a;\n}\n";
		const results = run("a.ts", content);
		expect(results.some((r) => r.rule.startsWith("bracket:unclosed:("))).toBe(
			true,
		);
	});

	test("still flags a template literal left open at end of file", () => {
		const results = run("a.ts", "const s = `never closed\nstill going\n");
		expect(
			results.some((r) => r.rule.startsWith("bracket:unterminated-string")),
		).toBe(true);
	});

	test("Go: backtick raw strings span multiple lines without false positives", () => {
		const content = 'const s = `line one\nline two "quoted"\nline three`\n';
		expect(run("a.go", content)).toHaveLength(0);
	});

	test("regression: a bracket char class in a regex literal (changesets/changesets getLastJsonObjectFromString.ts shape)", () => {
		const content = [
			"export const getLastJsonObjectFromString = (str: string) => {",
			'  str = str.replace(/[^}]*$/, "");',
			"  return str;",
			"};",
			"",
		].join("\n");
		expect(run("getLastJsonObjectFromString.ts", content)).toHaveLength(0);
	});

	test("regression: regex literals inside a template interpolation (changesets/changesets test-utils.ts shape)", () => {
		const content = [
			"export function pkg({",
			"  name,",
			"  version,",
			"}: {",
			"  name: string;",
			"  version: string;",
			"}): Package {",
			"  return {",
			"    packageJson: {",
			"      name,",
			"      version,",
			"    },",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
			'    dir: `/packages/${name.replace(/^@/, "").replace(/\\//g, "-")}`,',
			"  };",
			"}",
			"",
		].join("\n");
		expect(run("test-utils.ts", content)).toHaveLength(0);
	});

	test("division (`a / b / c`, `x = y / 2`) is scanned as ordinary code, not a regex", () => {
		const content = [
			"function f(a, b, c) {",
			"  return a / b / c;",
			"}",
			"const x = y / 2;",
			"",
		].join("\n");
		expect(run("a.ts", content)).toHaveLength(0);
	});

	test("division is told apart from a regex literal by the previous token, not just slash-counting", () => {
		// If the first "/" were wrongly read as starting a regex (identifiers
		// aren't a regex-ok previous token — only operators/keywords/start-of-
		// file are), its lookahead would find the *second* "/" as a bogus
		// closer and swallow the real "(" vs "]" mismatch between them as
		// inert "pattern text," missing it entirely.
		const content = "const x = a / (b + c] / d;\n";
		const results = run("a.ts", content);
		expect(results.some((r) => r.rule.startsWith("bracket:mismatched:("))).toBe(
			true,
		);
	});

	test("a real unclosed bracket after a regex literal is still caught", () => {
		const content = "const re = /ab+c/;\nfunction f(a, b {\n  return a;\n}\n";
		const results = run("a.ts", content);
		expect(results.some((r) => r.rule.startsWith("bracket:unclosed:("))).toBe(
			true,
		);
	});

	test("skips languages outside the supported set entirely", () => {
		expect(run("a.rb", "def f( unbalanced")).toHaveLength(0);
	});

	test("skips files with no readable content", () => {
		expect(
			bracketBalance({
				file: file("a.ts"),
				content: undefined,
				worldFiles: new Set(),
			}),
		).toHaveLength(0);
	});
});
