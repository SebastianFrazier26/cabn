import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { encodingIssue } from "../../src/annotate/encodingIssue.js";
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
	return encodingIssue({
		file: file(path),
		content,
		worldFiles: new Set([path]),
	});
}

describe("encodingIssue", () => {
	test("flags a file containing the Unicode replacement character", () => {
		const results = run("a.txt", `line one\nlast � word\n`);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "InvalidMode",
			species: "warded-mimic",
			loc: { line: 1 },
		});
	});

	test("reports one monster (not one per occurrence) for multiple bad characters", () => {
		const results = run("a.txt", `���`);
		expect(results).toHaveLength(1);
		expect(results[0]?.message).toContain("3");
	});

	test("clean text produces no issues", () => {
		expect(run("a.txt", "perfectly normal text\n")).toHaveLength(0);
	});

	test("skips files with no readable content", () => {
		expect(
			encodingIssue({
				file: file("a.txt"),
				content: undefined,
				worldFiles: new Set(),
			}),
		).toHaveLength(0);
	});
});
