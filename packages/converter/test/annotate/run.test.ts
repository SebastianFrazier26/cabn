import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import type { AnnotateFileInput } from "../../src/annotate/run.js";
import { annotateWorld } from "../../src/annotate/run.js";
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

// todoMarker has no per-file cap of its own (unlike codeSmell/deadCode/etc),
// making it a convenient way to drive the run.ts-level combined cap without
// depending on any one annotator's internal limit.
function todoFile(path: string, count: number): AnnotateFileInput {
	const content = Array.from(
		{ length: count },
		(_, i) => `// TODO distinct item ${i}\n`,
	).join("");
	return { file: file(path), content };
}

describe("annotateWorld: built-in annotator caps", () => {
	test("caps combined built-in monster count for one file well past any single annotator's own limit", () => {
		const result = annotateWorld([todoFile("a.ts", 40)], new Map(), []);
		expect(result.monsters).toHaveLength(20);
	});

	test("does not cap a file with a legitimately small number of issues", () => {
		const result = annotateWorld([todoFile("b.ts", 5)], new Map(), []);
		expect(result.monsters).toHaveLength(5);
	});

	test("caps the world-wide built-in monster total across many files", () => {
		const files = Array.from({ length: 110 }, (_, i) =>
			todoFile(`f${i}.ts`, 20),
		);
		const result = annotateWorld(files, new Map(), []);
		expect(result.monsters).toHaveLength(2000);
	});

	test("world-wide cap still leaves files under the per-file cap unaffected", () => {
		const files = [todoFile("only-one.ts", 3)];
		const result = annotateWorld(files, new Map(), []);
		expect(result.monsters).toHaveLength(3);
	});
});
