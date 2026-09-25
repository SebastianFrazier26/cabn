import { describe, expect, it } from "vitest";
import {
	navigationIntentForHit,
	resolveSearchScope,
	searchFileLines,
	toWorldSearchHits,
} from "../src/systems/search.js";

describe("resolveSearchScope", () => {
	it("scopes to the world while walking around", () => {
		expect(resolveSearchScope("world")).toBe("world");
	});

	it("scopes to the open file once inside one", () => {
		expect(resolveSearchScope("file")).toBe("file");
	});
});

describe("navigationIntentForHit", () => {
	it("maps a world hit to walk-to-portal", () => {
		const intent = navigationIntentForHit({
			kind: "world",
			portalId: "src/index.ts",
			path: "src/index.ts",
			name: "index.ts",
			previewLine: "",
		});
		expect(intent).toEqual({
			type: "walk-to-portal",
			portalId: "src/index.ts",
		});
	});

	it("maps a file hit to jump-to-line", () => {
		const intent = navigationIntentForHit({
			kind: "file",
			line: 41,
			snippet: "foo",
		});
		expect(intent).toEqual({ type: "jump-to-line", line: 41 });
	});
});

describe("toWorldSearchHits", () => {
	it("maps raw minisearch-shaped results into WorldSearchHit, looking up preview lines", () => {
		const previewLineByPortalId = new Map([
			["src/index.ts", "export const x = 1;"],
		]);
		const hits = toWorldSearchHits(
			[{ id: "src/index.ts", path: "src/index.ts", name: "index.ts" }],
			previewLineByPortalId,
		);
		expect(hits).toEqual([
			{
				kind: "world",
				portalId: "src/index.ts",
				path: "src/index.ts",
				name: "index.ts",
				previewLine: "export const x = 1;",
			},
		]);
	});

	it("falls back to an empty preview line when there's no entry for the id", () => {
		const hits = toWorldSearchHits(
			[{ id: "a.md", path: "a.md", name: "a.md" }],
			new Map(),
		);
		expect(hits[0].previewLine).toBe("");
	});

	it("stringifies a non-string id", () => {
		const hits = toWorldSearchHits(
			[{ id: 42, path: "p", name: "n" }],
			new Map(),
		);
		expect(hits[0].portalId).toBe("42");
	});
});

describe("searchFileLines", () => {
	const lines = ["import x from 'y'", "function foo() {", "  return FOO;", "}"];

	it("returns matches with 0-based line indices, case-insensitively", () => {
		const hits = searchFileLines(lines, "foo");
		expect(hits).toEqual([
			{ kind: "file", line: 1, snippet: "function foo() {" },
			{ kind: "file", line: 2, snippet: "  return FOO;" },
		]);
	});

	it("returns an empty array for a blank query", () => {
		expect(searchFileLines(lines, "   ")).toEqual([]);
	});

	it("returns an empty array when nothing matches", () => {
		expect(searchFileLines(lines, "zzz")).toEqual([]);
	});

	it("truncates a long matching line with an ellipsis", () => {
		const longLine = `x${"a".repeat(200)}match`;
		const hits = searchFileLines([longLine], "match");
		expect(hits[0].snippet.endsWith("…")).toBe(true);
		expect(hits[0].snippet.length).toBe(80);
	});
});
