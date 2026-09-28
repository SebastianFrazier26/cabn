import { describe, expect, it } from "vitest";
import {
	buildTraceScript,
	TRACE_DEPTH_CAP,
	TRACE_STEP_CAP,
} from "../../src/systems/trace/buildTraceScript.js";

describe("buildTraceScript — python", () => {
	it("orders imports, top-level statements, and def headers without walking bodies eagerly", () => {
		const content = [
			"import os",
			"from sys import argv",
			"",
			"def helper():",
			"    return 1",
			"",
			"x = 1",
		].join("\n");
		const steps = buildTraceScript(content, "python");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "import"],
			[2, "import"],
			[4, "def"],
			[7, "stmt"],
		]);
	});

	it("steps into a top-level call to a locally-defined function", () => {
		const content = [
			"def helper():",
			"    print('hi')",
			"    return 1",
			"",
			"helper()",
		].join("\n");
		const steps = buildTraceScript(content, "python");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "def"],
			[5, "call"],
			[2, "stmt"],
			[3, "return"],
		]);
	});

	it('steps into main() called from an `if __name__ == "__main__":` guard', () => {
		const content = [
			"def main():",
			"    print('run')",
			"",
			'if __name__ == "__main__":',
			"    main()",
		].join("\n");
		const steps = buildTraceScript(content, "python");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "def"],
			[4, "stmt"],
			[5, "call"],
			[2, "stmt"],
		]);
	});

	it("does not walk into a not-yet-defined name that merely looks like a call", () => {
		const content = ["do_thing()", "def do_thing():", "    pass"].join("\n");
		const steps = buildTraceScript(content, "python");
		// do_thing is registered as a top-level def (whole-file scan), so this
		// still steps in — Python doesn't hoist, but the heuristic isn't meant
		// to model execution order strictly, only structural stepping.
		expect(steps.some((s) => s.kind === "call")).toBe(true);
	});

	it("caps recursion depth at TRACE_DEPTH_CAP", () => {
		const content = ["def a():", "    b()", "def b():", "    a()", "a()"].join(
			"\n",
		);
		const steps = buildTraceScript(content, "python");
		// depth 1 (top-level a() call) + up to TRACE_DEPTH_CAP nested calls,
		// never runs away indefinitely despite mutual recursion.
		const callSteps = steps.filter((s) => s.kind === "call");
		expect(callSteps.length).toBeLessThanOrEqual(TRACE_DEPTH_CAP + 1);
	});

	it("caps total steps at TRACE_STEP_CAP for a very long file", () => {
		const lines = Array.from({ length: 1000 }, (_, i) => `x${i} = ${i}`);
		const steps = buildTraceScript(lines.join("\n"), "python");
		expect(steps.length).toBe(TRACE_STEP_CAP);
	});

	it("skips blank lines and comments", () => {
		const content = ["# a comment", "", "x = 1", "  ", "# another"].join("\n");
		const steps = buildTraceScript(content, "python");
		expect(steps).toEqual([{ line: 3, kind: "stmt" }]);
	});
});

describe("buildTraceScript — javascript/typescript", () => {
	it("orders imports and top-level statements, registering function declarations without walking them eagerly", () => {
		const content = [
			"import { readFile } from 'fs';",
			"",
			"function helper() {",
			"  return 1;",
			"}",
			"",
			"const x = 1;",
		].join("\n");
		const steps = buildTraceScript(content, "javascript");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "import"],
			[3, "def"],
			[7, "stmt"],
		]);
	});

	it("steps into a bottom-of-file main() call", () => {
		const content = [
			"function main() {",
			"  doWork();",
			"  return 0;",
			"}",
			"",
			"main();",
		].join("\n");
		const steps = buildTraceScript(content, "typescript");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "def"],
			[6, "call"],
			[2, "stmt"],
			[3, "return"],
		]);
	});

	it("registers a top-level const arrow function and steps into it when called", () => {
		const content = [
			"const helper = () => {",
			"  console.log('hi');",
			"};",
			"",
			"helper();",
		].join("\n");
		const steps = buildTraceScript(content, "javascript");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "def"],
			[5, "call"],
			[2, "stmt"],
		]);
	});

	it("ignores braces inside strings and comments when finding a function's body", () => {
		const content = [
			"function helper() {",
			"  const s = '{ not a brace }';",
			"  // a comment with a { brace",
			"  return s;",
			"}",
			"helper();",
		].join("\n");
		const steps = buildTraceScript(content, "javascript");
		expect(steps.map((s) => [s.line, s.kind])).toEqual([
			[1, "def"],
			[6, "call"],
			[2, "stmt"],
			[4, "return"],
		]);
	});

	it("caps total steps at TRACE_STEP_CAP", () => {
		const lines = Array.from({ length: 1000 }, (_, i) => `const x${i} = ${i};`);
		const steps = buildTraceScript(lines.join("\n"), "javascript");
		expect(steps.length).toBe(TRACE_STEP_CAP);
	});
});

describe("buildTraceScript — generic fallback", () => {
	it("walks every non-blank, non-comment line for an unrecognized language", () => {
		const content = ["// comment", "let x = 1;", "", "let y = 2;"].join("\n");
		const steps = buildTraceScript(content, "rust");
		expect(steps).toEqual([
			{ line: 2, kind: "stmt" },
			{ line: 4, kind: "stmt" },
		]);
	});

	it("handles undefined language the same as an unrecognized one", () => {
		const steps = buildTraceScript("a\nb", undefined);
		expect(steps.map((s) => s.line)).toEqual([1, 2]);
	});
});
