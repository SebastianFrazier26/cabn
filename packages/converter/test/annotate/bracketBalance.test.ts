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
