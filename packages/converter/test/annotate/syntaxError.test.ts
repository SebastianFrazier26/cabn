import { describe, expect, test } from "vitest";
import { bracketBalance } from "../../src/annotate/bracketBalance.js";
import { syntaxError } from "../../src/annotate/syntaxError.js";
import { MAX_TREE_CHARS } from "../../src/annotate/syntaxTree.js";
import { runOn } from "./helpers.js";

const run = (path: string, content: string) =>
	runOn(syntaxError, path, content);

describe("syntaxError (imp)", () => {
	test.each([
		["a.js", "const a = ;\nconst b = 2;\n", 0],
		["a.jsx", "export const C = () => <div>{1 +}</div>;\n", 0],
		["a.py", "import os\n\ndef f()\n    return os.sep\n", 2],
		["a.py", "x = = 2\n", 0],
		["a.css", "a { color red; }\n", 0],
		["a.html", "<div><span></div>\n", 0],
	])("flags a real parse error in %s", (path, content, line) => {
		const results = run(path, content);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "SyntaxError",
			species: "imp",
			tier: 2,
			loc: { line },
		});
		expect(results[0]?.rule).toMatch(/^syntax:[a-z]+:[0-9a-f]{8}$/);
	});

	test("TypeScript is out of scope: the grammar can't tell its gaps from real errors", () => {
		expect(run("a.ts", "const x: number = 1 +;\n")).toEqual([]);
		expect(run("a.tsx", "export const C = () => <div>{1 +}</div>;\n")).toEqual(
			[],
		);
		for (const valid of [
			"try {} catch (e: any) {}\n",
			"let entries!: [string, number][];\n",
			"const ok = xs.filter((c): c is Node => c !== undefined);\n",
			'export { configure, type Config } from "./m.js";\n',
			'type PdfJs = typeof import("pdfjs-dist");\n',
		]) {
			expect(run("gap.ts", valid)).toEqual([]);
		}
	});

	test.each([
		// Known Lezer grammar gaps (syntaxTree.ts's GAP_* lists): valid code the
		// pinned grammar still marks with error nodes.
		[
			"gap.js",
			"const { a, b = 1 } = o;\nfunction f({ c = 2 }) { return c; }\nfunction g({ path, prefixing = false, isFastify = false }) {}\n",
		],
		["gap.js", "import data from './d.json' with { type: 'json' };\n"],
		[
			"gap.jsx",
			"const a = (\n\t<div>\n\t\t{/* a comment\n\t\t   over lines */}\n\t\t<span />\n\t\t{}\n\t</div>\n);\n",
		],
		[
			"gap.py",
			"@buttons[0].clicked.connect\ndef f(): pass\n\ng = lambda a, /, b: a\nx = a[*b]\n",
		],
		["gap.css", "@import url('x.css') layer(base) supports(display: grid);\n"],
		[
			"ok.jsx",
			"const el = <Foo.Bar x={y}><Baz /></Foo.Bar>;\nconst r = /ab+c/g;\nclass A { #p = 1; static {} get x() { return this.#p } }\n",
		],
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test, not a template
		["ok.js", "#!/usr/bin/env node\nconsole.log(`a${b}c`);\n"],
		[
			"ok.py",
			'from . import x\n\nasync def f(a, /, b, *, c=1, **kw):\n    match a:\n        case 1 | 2:\n            return [i async for i in b if i]\n        case _:\n            pass\n    if (n := len(kw)) > 5:\n        raise ValueError(f"bad {a!r}")\n\ntype X = int\n',
		],
		[
			"ok.css",
			"@media (max-width: 3px) { .b > c:hover::after { margin: 0 auto !important } }\n:root { --x: 1px }\n.a { .b { color: blue } }\n",
		],
		[
			"ok.html",
			"<!doctype html><ul><li>a<li>b</ul><p>x<p>y<table><tr><td>a</table><img src=x><br>\n",
		],
	])("no false positive on valid %s", (path, content) => {
		expect(run(path, content)).toEqual([]);
	});

	test("defers to the gremlin when bracketBalance already flags the file (one mistake, one monster)", () => {
		const content = "function f() {\n  return [1, 2;\n}\nconst z = 2;\n";
		expect(runOn(bracketBalance, "a.js", content).length).toBeGreaterThan(0);
		expect(run("a.js", content)).toEqual([]);

		const unterminated = "const s = 'abc\nconst y = 2;\n";
		expect(runOn(bracketBalance, "a.js", unterminated).length).toBeGreaterThan(
			0,
		);
		expect(run("a.js", unterminated)).toEqual([]);
	});

	test("collapses a cascade of parser errors on nearby lines into one imp, caps the rest", () => {
		const cascade = "const a = ;\nconst b = ;\nconst c = ;\n";
		expect(run("a.js", cascade)).toHaveLength(1);

		const spread = Array.from({ length: 10 }, (_, i) =>
			i % 2 === 0 ? "let x = ;" : "\n\n\n\n",
		).join("\n");
		expect(run("a.js", spread)).toHaveLength(3);
	});

	test("rule anchors on the offending line's text, not its position", () => {
		const before = run("a.js", "const a = ;\n")[0];
		const shifted = run("a.js", "// a new first line\n\nconst a = ;\n")[0];
		expect(shifted?.loc?.line).toBe(2);
		expect(shifted?.rule).toBe(before?.rule);
	});

	test("skips template-flavoured HTML, Flow JS, JSON/markdown, and oversized files", () => {
		expect(run("t.html", "<div>{% if x %}<span></div>\n")).toEqual([]);
		expect(run("f.js", "// @flow\nfunction f(x: ?number) {}\n")).toEqual([]);
		expect(run("c.json", "{ nope ")).toEqual([]);
		expect(run("r.md", "# [unclosed\n")).toEqual([]);
		expect(run("big.js", `const a = ;\n${" ".repeat(MAX_TREE_CHARS)}`)).toEqual(
			[],
		);
	});

	test("an error at end of file points at the last line with text", () => {
		const results = run("a.py", "import os\n\ndef f():\n");
		expect(results[0]?.loc?.line).toBe(2);
	});
});
