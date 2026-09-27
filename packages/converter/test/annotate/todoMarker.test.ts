import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { todoMarker } from "../../src/annotate/todoMarker.js";
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
	return todoMarker({ file: file(path), content, worldFiles: new Set([path]) });
}

describe("todoMarker", () => {
	test("flags TODO in a line comment", () => {
		const results = run("a.ts", "// TODO: refactor this\nconst x = 1;\n");
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "WispNote",
			species: "will-o-wisp",
			tier: 0,
		});
	});

	test("flags FIXME/XXX/HACK too, each as its own wisp", () => {
		const results = run("a.ts", "// FIXME one\n// XXX two\n// HACK three\n");
		expect(results).toHaveLength(3);
	});

	test("flags TODO in a block comment", () => {
		expect(run("a.ts", "/* TODO later */\n")).toHaveLength(1);
	});

	test("does not flag TODO inside a string literal", () => {
		expect(run("a.ts", 'const s = "TODO not a marker";\n')).toHaveLength(0);
	});

	test("does not flag plain code with no marker", () => {
		expect(run("a.ts", "const x = 1;\n")).toHaveLength(0);
	});

	test("flags TODO in a Python comment", () => {
		expect(run("a.py", "# TODO: fix\nx = 1\n")).toHaveLength(1);
	});

	test("flags TODO inside an HTML comment in markdown", () => {
		expect(run("a.md", "<!-- TODO write more -->\n# Heading\n")).toHaveLength(
			1,
		);
	});

	test("does not flag plain-text TODO in markdown prose (no comment syntax)", () => {
		expect(
			run("a.md", "TODO: this is just prose, not a comment\n"),
		).toHaveLength(0);
	});

	test("skips languages with no known comment syntax", () => {
		expect(run("a.rb", "# TODO ruby not supported here")).toHaveLength(0);
	});
});
