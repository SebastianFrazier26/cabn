import {
	buildSearchIndex,
	SEARCH_FIELDS,
	SEARCH_STORE_FIELDS,
	type SearchDoc,
} from "@cabn/converter/browser";
import type { SignEntry } from "@cabn/world-schema";
import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import {
	isStaleSignHit,
	syncSignSearchDocs,
} from "../src/systems/signSearch.js";

function sign(path: string, source: string): SignEntry {
	return { path, source, anchor: { kind: "cluster", id: "c0" } };
}

/** An index as the orb gets it: built by the converter, round-tripped through JSON. */
function loadedIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
	return MiniSearch.loadJSON<SearchDoc>(
		JSON.stringify(buildSearchIndex(docs).index),
		{ fields: [...SEARCH_FIELDS], storeFields: [...SEARCH_STORE_FIELDS] },
	);
}

const ids = (index: MiniSearch<SearchDoc>, q: string) =>
	index.search(q, { prefix: true }).map((r) => r.id);

describe("syncSignSearchDocs", () => {
	it("adds a sign saved after the index was built, titled from its heading", () => {
		const index = loadedIndex([
			{ id: "src/a.ts", path: "src/a.ts", name: "a.ts", content: "alpha" },
		]);
		const synced = syncSignSearchDocs(
			index,
			[sign("src/welcome.seyn", "# Greenhouse\nwatering schedule")],
			new Map(),
		);
		expect(ids(index, "watering")).toEqual(["src/welcome.seyn"]);
		expect(index.search("greenhouse")[0]?.name).toBe("Greenhouse");
		expect(synced.get("src/welcome.seyn")).toContain("watering");
	});

	it("replaces an edited sign's text and discards a deleted one", () => {
		const index = loadedIndex([
			{ id: "notes.seyn", path: "notes.seyn", name: "notes", content: "old" },
		]);
		let synced = syncSignSearchDocs(
			index,
			[sign("notes.seyn", "brand new words")],
			new Map(),
		);
		expect(ids(index, "old")).toEqual([]);
		expect(ids(index, "brand")).toEqual(["notes.seyn"]);

		synced = syncSignSearchDocs(index, [], synced);
		expect(ids(index, "brand")).toEqual([]);
		expect(index.has("notes.seyn")).toBe(false);
		expect(synced.size).toBe(0);
	});

	it("leaves unchanged signs alone on a later sync", () => {
		const calls: string[] = [];
		const fake = {
			has: () => true,
			add: (d: SearchDoc) => calls.push(`add ${d.id}`),
			replace: (d: SearchDoc) => calls.push(`replace ${d.id}`),
			discard: (id: string) => calls.push(`discard ${id}`),
		};
		const list = [sign("a.seyn", "a"), sign("b.seyn", "b")];
		const synced = syncSignSearchDocs(fake, list, new Map());
		calls.length = 0;
		syncSignSearchDocs(
			fake,
			[list[0] as SignEntry, sign("b.seyn", "b2")],
			synced,
		);
		expect(calls).toEqual(["replace b.seyn"]);
	});
});

describe("isStaleSignHit", () => {
	it("hides only sign docs missing from the live list", () => {
		const live = new Set(["kept.seyn"]);
		expect(isStaleSignHit("gone.seyn", live)).toBe(true);
		expect(isStaleSignHit("kept.seyn", live)).toBe(false);
		expect(isStaleSignHit("src/index.ts", live)).toBe(false);
	});
});
