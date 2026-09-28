import { describe, expect, test } from "vitest";
import {
	codeSmell,
	smellOptionsFromRule,
} from "../../src/annotate/codeSmell.js";
import { runOn } from "./helpers.js";

const run = runOn.bind(null, codeSmell);
const kinds = (
	path: string,
	content: string,
	options?: Parameters<typeof runOn>[3],
) => run(path, content, options).map((r) => r.rule.split(":")[0]);

function jsFunction(name: string, bodyLines: number): string {
	const body = Array.from({ length: bodyLines }, (_, i) => `  total += ${i};`);
	return [
		`export function ${name}() {`,
		"  let total = 0;",
		...body,
		"  return total;",
		"}",
	].join("\n");
}

describe("codeSmell (bramble) — long functions", () => {
	test("flags a function over the default 80-line limit, with the limit in the rule", () => {
		const results = run("a.ts", jsFunction("huge", 90));
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "CodeSmell",
			species: "bramble",
			tier: 1,
			rule: "long-function:huge:80",
			loc: { line: 0, col: 7 },
		});
		expect(results[0]?.message).toContain("94 lines");
		expect(run("a.ts", jsFunction("fine", 70))).toEqual([]);
	});

	test("honours a configured limit, and reads it back out of the rule", () => {
		const results = run("a.ts", jsFunction("medium", 30), {
			maxFunctionLines: 20,
		});
		expect(results.map((r) => r.rule)).toEqual(["long-function:medium:20"]);
		expect(smellOptionsFromRule("long-function:medium:20")).toEqual({
			maxFunctionLines: 20,
		});
		expect(smellOptionsFromRule("deep-nesting:f:6#2")).toEqual({
			maxNestingDepth: 6,
		});
		expect(smellOptionsFromRule("duplicate:abcd1234")).toEqual({});
	});

	test("names arrows, methods and Python defs; reports only the outermost of nested long functions", () => {
		const inner = Array.from({ length: 30 }, () => "    x();").join("\n");
		const content = `const outer = () => {\n  const cb = () => {\n${inner}\n  };\n  return cb;\n};\n`;
		expect(
			run("a.js", content, { maxFunctionLines: 20 }).map((r) => r.rule),
		).toEqual(["long-function:outer:20"]);
		const method = `export class K {\n  run() {\n${inner}\n  }\n}\n`;
		expect(run("a.ts", method, { maxFunctionLines: 20 })[0]?.rule).toBe(
			"long-function:run:20",
		);
		const py = `def crunch(xs):\n${Array.from({ length: 25 }, () => "    xs.pop()").join("\n")}\n`;
		expect(run("a.py", py, { maxFunctionLines: 20 })[0]?.rule).toBe(
			"long-function:crunch:20",
		);
	});
});

describe("codeSmell (bramble) — nesting", () => {
	const deep = [
		"export function walk(t) {",
		"  for (const a of t) {",
		"    if (a) {",
		"      while (a.next) {",
		"        try {",
		"          if (a.x) { a.y(); }",
		"        } catch {}",
		"      }",
		"    }",
		"  }",
		"}",
	].join("\n");

	test("flags control flow nested past the limit, at the deepest point", () => {
		const results = run("a.js", deep);
		expect(results).toHaveLength(1);
		expect(results[0]?.rule).toBe("deep-nesting:walk:4");
		expect(results[0]?.loc?.line).toBe(5);
		expect(run("a.js", deep, { maxNestingDepth: 5 })).toEqual([]);
	});

	test("else-if chains are one level, and each function starts from zero", () => {
		const chain = [
			"export function f(a) {",
			"  if (a === 1) {} else if (a === 2) {} else if (a === 3) {} else if (a === 4) {} else if (a === 5) {}",
			"}",
		].join("\n");
		expect(run("a.js", chain)).toEqual([]);
		const split = [
			"export function f(a) { if (a) { if (a) { if (a) { return g; } } } }",
			"function g(b) { for (;;) { if (b) { while (b) { return; } } } }",
			"export { g };",
		].join("\n");
		expect(run("a.js", split)).toEqual([]);
	});

	test("Python nesting counts if/for/while/try/with/match", () => {
		const py = [
			"def f(xs):",
			"    for x in xs:",
			"        with open(x) as fh:",
			"            try:",
			"                if fh:",
			"                    while True:",
			"                        break",
			"            except OSError:",
			"                pass",
		].join("\n");
		expect(run("m.py", py).map((r) => r.rule)).toEqual(["deep-nesting:f:4"]);
	});
});

describe("codeSmell (bramble) — debug leftovers", () => {
	test("flags console.log/debug and debugger in library code", () => {
		const content =
			"export function f(x) {\n  console.log(x);\n  debugger;\n  console.error(x);\n  return x;\n}\n";
		expect(
			run("src/lib.js", content).map((r) =>
				r.rule.replace(/:[0-9a-f]{8}$/, ""),
			),
		).toEqual(["debug:console.log", "debug:debugger"]);
	});

	test("printing is fine in scripts, tests, CLIs and __main__ modules; debugger/breakpoint never are", () => {
		const log = "console.log('hi');\n";
		expect(run("scripts/seed.js", log)).toEqual([]);
		expect(run("src/cli.ts", log)).toEqual([]);
		expect(run("src/a.test.ts", log)).toEqual([]);
		expect(
			run("src/tool.js", "#!/usr/bin/env node\nconsole.log(1);\n"),
		).toEqual([]);
		expect(
			run(
				"src/run.js",
				"const args = process.argv.slice(2);\nconsole.log(args);\n",
			),
		).toEqual([]);
		expect(run("scripts/seed.js", "debugger;\n")).toHaveLength(1);

		expect(
			kinds("pkg/util.py", "def f(x):\n    print(x)\n    return x\n"),
		).toEqual(["debug"]);
		expect(
			run(
				"pkg/util.py",
				"def f():\n    pass\n\nif __name__ == '__main__':\n    print(f())\n",
			),
		).toEqual([]);
		expect(run("pkg/cmd.py", "import argparse\nprint(argparse)\n")).toEqual([]);
		expect(
			run(
				"scripts/x.py",
				"import pdb\ndef f():\n    breakpoint()\n    pdb.set_trace()\n",
			).map((r) => r.rule.replace(/:[0-9a-f]{8}$/, "")),
		).toEqual(["debug:breakpoint", "debug:pdb.set_trace"]);
	});

	test("ignores console.log inside strings and comments", () => {
		expect(
			run(
				"src/lib.js",
				"// console.log(x)\nexport const s = 'console.log(x)';\n",
			),
		).toEqual([]);
	});
});

describe("codeSmell (bramble) — duplicated blocks", () => {
	const block = [
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
		"  const response = await fetch(`${baseUrl}/gardeners/${id}`);",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
		"  if (!response.ok) throw new Error(`failed: ${response.status}`);",
		"  const body = await response.json();",
		"  const cleaned = body.items.filter((item) => item.active);",
		"  cache.set(id, cleaned);",
		"  return cleaned.map((item) => item.name);",
	];

	test("flags a repeated block of six significant lines once, pointing at the copy", () => {
		const content = [
			"export async function a(id) {",
			...block,
			"}",
			"",
			"export async function b(id) {",
			...block.map((l) => `    ${l.trim()}`),
			"}",
		].join("\n");
		const results = run("src/api.js", content);
		expect(results).toHaveLength(1);
		expect(results[0]?.rule).toMatch(/^duplicate:[0-9a-f]{8}$/);
		expect(results[0]?.loc?.line).toBe(10);
		expect(results[0]?.message).toContain("lines 2-7");
	});

	test("short or trivial repeats and test files don't count", () => {
		const trivial = Array.from(
			{ length: 4 },
			() => "  }\n  return x;\n}\n",
		).join("\n");
		expect(run("src/a.js", trivial)).toEqual([]);
		const dup = [
			"function a() {",
			...block,
			"}",
			"function b() {",
			...block,
			"}",
		].join("\n");
		expect(run("tests/api.test.js", dup)).toEqual([]);
		expect(run("config.json", dup)).toEqual([]);
	});

	test("covers code files without a tree grammar too", () => {
		const goBlock = block.map((l) => l.replace(/const |await /g, ""));
		const content = [
			"func a() {",
			...goBlock,
			"}",
			"func b() {",
			...goBlock,
			"}",
		].join("\n");
		expect(kinds("main.go", content)).toEqual(["duplicate"]);
	});
});
