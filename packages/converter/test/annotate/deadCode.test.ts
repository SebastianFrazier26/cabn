import { describe, expect, test } from "vitest";
import { deadCode } from "../../src/annotate/deadCode.js";
import { runOn } from "./helpers.js";

const run = (path: string, content: string) => runOn(deadCode, path, content);
const rules = (path: string, content: string) =>
	run(path, content).map((r) => r.rule);

describe("deadCode (skeleton) — JS/TS", () => {
	test("flags unused imports (named, default, namespace, aliased, type)", () => {
		const content = [
			'import fs from "node:fs";',
			'import * as path from "node:path";',
			'import { a, b as c, type T } from "./x";',
			'import { used } from "./y";',
			"export const z = used();",
		].join("\n");
		expect(rules("a.ts", content)).toEqual([
			"unused-import:fs",
			"unused-import:path",
			"unused-import:a",
			"unused-import:c",
			"unused-import:T",
		]);
		const first = run("a.ts", content)[0];
		expect(first).toMatchObject({
			code: "DeadCode",
			species: "skeleton",
			tier: 1,
			loc: { line: 0, col: 7 },
		});
	});

	test("counts every real use: calls, types, JSX, shorthand, re-export, typeof", () => {
		const content = [
			'import React from "react";',
			'import { A, B, C, D, E, F } from "./x";',
			"const el = <A.Item />;",
			"let t: B<number>;",
			"const o = { C };",
			"export { D };",
			"type G = typeof E;",
			"export default function g() { return F(el, t, o) as unknown as G; }",
		].join("\n");
		expect(rules("a.tsx", content)).toEqual([]);
	});

	test("flags unused locals and module-private top-level declarations", () => {
		const content = [
			'import { x } from "./x";',
			"const unusedTop = 1;",
			"function helper() {}",
			"export function main(param, _ignored) {",
			"  const unusedLocal = x + 1;",
			"  let [p, q] = [1, 2];",
			"  const kept = 2;",
			"  for (const item of []) {}",
			"  try {} catch (err) {}",
			"  return kept + p;",
			"}",
		].join("\n");
		expect(rules("a.js", content)).toEqual([
			"unused-var:unusedTop",
			"unused-var:helper",
			"unused-var:unusedLocal",
			"unused-var:q",
		]);
	});

	test("leaves top-level names of non-module scripts, exports, _-names and .d.ts alone", () => {
		expect(
			rules("page.js", "var globalThing = 1;\nfunction onLoad() {}\n"),
		).toEqual([]);
		expect(
			rules(
				"a.ts",
				"export const a = 1;\nexport class B {}\nconst _c = 2;\nexport {};\n",
			),
		).toEqual([]);
		expect(
			rules(
				"types.d.ts",
				'import { X } from "./x";\ndeclare const y: number;\n',
			),
		).toEqual([]);
	});

	test("bails out entirely around eval/with", () => {
		expect(
			rules(
				"a.js",
				'import { x } from "./x";\nfunction f() { const y = 1; return eval("y"); }\nexport { f };\n',
			),
		).toEqual([]);
	});

	test("flags unreachable statements after return/throw/break/continue", () => {
		const content = [
			"export function f(a) {",
			"  if (a) {",
			"    return 1;",
			"    console.log('never');",
			"  }",
			"  throw new Error('x');",
			"  a++;",
			"}",
			"export function g(k) {",
			"  switch (k) {",
			"    case 1: f(); break; f(2);",
			"    case 2: return f(3);",
			"    default: f(4);",
			"  }",
			"  return h();",
			"  function h() { return 0; }",
			"}",
		].join("\n");
		const results = run("a.js", content);
		expect(results.map((r) => [r.rule.split(":")[0], r.loc?.line])).toEqual([
			["unreachable", 3],
			["unreachable", 6],
			["unreachable", 10],
		]);
		expect(results[0]?.message).toContain('after "return"');
	});
});

describe("deadCode (skeleton) — Python", () => {
	test("flags unused imports, respecting aliases, dotted imports, strings and noqa", () => {
		const content = [
			"from __future__ import annotations",
			"import os, sys as system",
			"import xml.etree.ElementTree",
			"from typing import Optional, List",
			"import json  # noqa: F401",
			"from collections import OrderedDict as OD",
			"",
			"def f(a: 'Optional[int]') -> None:",
			"    print(xml.etree, a)",
		].join("\n");
		expect(rules("mod.py", content)).toEqual([
			"unused-import:os",
			"unused-import:system",
			"unused-import:List",
			"unused-import:OD",
		]);
	});

	test("skips imports in __init__.py and modules with __all__", () => {
		expect(rules("pkg/__init__.py", "from .a import b\n")).toEqual([]);
		expect(rules("pkg/m.py", "from .a import b\n__all__ = ['b']\n")).toEqual(
			[],
		);
	});

	test("flags unused function locals, not reads via f-strings, closures, globals, tuples or _", () => {
		const content = [
			"def f(a):",
			"    unused = a * 2",
			"    shown = 1",
			"    closed = 2",
			"    first, second = a",
			"    _tmp = 3",
			"    global counter",
			"    counter = 4",
			"    def inner():",
			"        return closed",
			'    return f"{shown}", inner',
			"",
			"module_level = 5",
		].join("\n");
		expect(rules("m.py", content)).toEqual(["unused-var:unused"]);
		expect(rules("m.py", "def g():\n    x = 1\n    return locals()\n")).toEqual(
			[],
		);
	});

	test("flags unreachable code after return/raise/break/continue", () => {
		const content = [
			"def f(xs):",
			"    for x in xs:",
			"        if x:",
			"            continue",
			"            print(x)",
			"    return 1",
			"    print('never')",
		].join("\n");
		expect(run("m.py", content).map((r) => r.loc?.line)).toEqual([4, 6]);
	});
});

describe("deadCode (skeleton) — scope", () => {
	test("CSS/HTML and unsupported languages get nothing", () => {
		expect(run("a.css", "a { color: red }\n")).toEqual([]);
		expect(run("a.go", 'package main\nimport "os"\n')).toEqual([]);
	});

	test("caps findings per file", () => {
		const imports = Array.from(
			{ length: 20 },
			(_, i) => `import { n${i} } from "./m${i}";`,
		).join("\n");
		expect(run("a.ts", imports)).toHaveLength(10);
	});
});
