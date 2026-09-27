import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { parseFailure } from "../../src/annotate/parseFailure.js";
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
	return parseFailure({
		file: file(path),
		content,
		worldFiles: new Set([path]),
	});
}

describe("parseFailure", () => {
	test("flags invalid JSON (trailing comma)", () => {
		const results = run("config.json", '{\n  "a": 1,\n}\n');
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "Corrupted",
			species: "rot-sprite",
		});
	});

	test("does not flag valid JSON", () => {
		expect(run("config.json", '{"a": 1}')).toHaveLength(0);
	});

	test("flags unterminated markdown frontmatter", () => {
		const results = run("post.md", "---\ntitle: hi\n\n# Body\n");
		expect(results).toHaveLength(1);
		expect(results[0]?.rule).toBe("frontmatter-unterminated");
	});

	test("does not flag markdown frontmatter that closes properly", () => {
		expect(run("post.md", "---\ntitle: hi\n---\n\n# Body\n")).toHaveLength(0);
	});

	test("does not flag markdown with no frontmatter at all", () => {
		expect(run("post.md", "# Just a heading\n")).toHaveLength(0);
	});

	test("does not attempt to parse non-JSON, non-markdown files", () => {
		expect(run("main.py", "not json { at all")).toHaveLength(0);
	});
});
