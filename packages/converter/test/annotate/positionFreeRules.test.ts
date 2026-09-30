import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { bracketBalance } from "../../src/annotate/bracketBalance.js";
import { brokenImport } from "../../src/annotate/brokenImport.js";
import { encodingIssue } from "../../src/annotate/encodingIssue.js";
import { jsonErrorKey, parseFailure } from "../../src/annotate/parseFailure.js";
import { todoMarker } from "../../src/annotate/todoMarker.js";
import type { Annotator } from "../../src/annotate/types.js";
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

function run(annotator: Annotator, path: string, content: string) {
	return annotator({ file: file(path), content, worldFiles: new Set([path]) });
}

// 2026-09-29: rules (and so monster ids and the fixed-check) no longer carry
// a line or column; only `loc` moves with the code.
const CASES: [string, Annotator, string, string][] = [
	["todo", todoMarker, "src/a.ts", "export const a = 1; // TODO: tidy\n"],
	["bracket", bracketBalance, "src/a.ts", "export const a = (1 + 2\n"],
	[
		"broken-import",
		brokenImport,
		"src/a.ts",
		'import { x } from "./gone.js";\n',
	],
	["encoding", encodingIssue, "notes.txt", "caf�\n"],
	["json-parse", parseFailure, "config.json", '{\n  "a": 1,\n}\n'],
];

describe("position-free rules", () => {
	for (const [name, annotator, path, content] of CASES) {
		test(`${name}: same rule after lines are inserted above, loc moves`, () => {
			const before = run(annotator, path, content);
			const after = run(annotator, path, `\n\n\n${content}`);
			expect(before).toHaveLength(1);
			expect(before[0]?.rule).not.toMatch(/@\d+:\d+|\d+:\d+$/);
			expect(after.map((r) => r.rule)).toEqual(before.map((r) => r.rule));
			expect(after[0]?.loc?.line).toBe((before[0]?.loc?.line ?? 0) + 3);
		});
	}

	test("identical findings in one file get an occurrence index, not a line", () => {
		const todos = run(
			todoMarker,
			"src/a.ts",
			"// TODO: tidy\nexport const a = 1;\n// TODO: tidy\n// TODO: other\n",
		).map((r) => r.rule);
		expect(todos[1]).toBe(`${todos[0]}#2`);
		expect(todos[2]).not.toContain("#");
		const brackets = run(bracketBalance, "src/a.ts", "f((1\n").map(
			(r) => r.rule,
		);
		expect(new Set(brackets).size).toBe(brackets.length);
	});

	test("the todo rule follows the note's text, whitespace-insensitively", () => {
		const [a] = run(todoMarker, "src/a.ts", "// TODO: tidy up\n");
		const [b] = run(todoMarker, "src/a.ts", "  //   TODO:   tidy   up\n");
		const [c] = run(todoMarker, "src/a.ts", "// TODO: tidy down\n");
		expect(b?.rule).toBe(a?.rule);
		expect(c?.rule).not.toBe(a?.rule);
	});

	test("jsonErrorKey drops both of V8's position forms", () => {
		expect(
			jsonErrorKey(
				"Expected double-quoted property name in JSON at position 69 (line 5 column 2)",
			),
		).toBe("Expected double-quoted property name in JSON");
		expect(jsonErrorKey("Unexpected token } in JSON at position 12")).toBe(
			"Unexpected token } in JSON",
		);
	});
});
