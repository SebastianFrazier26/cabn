import MiniSearch from "minisearch";
import { describe, expect, test } from "vitest";
import {
	buildSearchIndex,
	SEARCH_FIELDS,
	SEARCH_STORE_FIELDS,
} from "../src/search-index.js";

describe("buildSearchIndex", () => {
	test("produces a SearchIndexFile shape", () => {
		const file = buildSearchIndex([
			{ id: "a.py", path: "a.py", name: "a.py", content: "def greet(): pass" },
		]);
		expect(file.engine).toBe("minisearch");
		expect(typeof file.version).toBe("string");
		expect(file.index).toBeTruthy();
	});

	test("round-trips through MiniSearch.loadJSON and finds a known string", () => {
		const file = buildSearchIndex([
			{
				id: "helper.py",
				path: "pkg/helper.py",
				name: "helper.py",
				content: "def greet(name): return name",
			},
			{
				id: "other.py",
				path: "pkg/other.py",
				name: "other.py",
				content: "def unrelated(): pass",
			},
		]);

		const restored = MiniSearch.loadJSON<{ path: string; name: string }>(
			JSON.stringify(file.index),
			{
				fields: [...SEARCH_FIELDS],
				storeFields: [...SEARCH_STORE_FIELDS],
			},
		);

		const results = restored.search("greet");
		expect(results.map((r) => r.id)).toContain("helper.py");
		expect(results.some((r) => r.id === "other.py")).toBe(false);
	});
});
