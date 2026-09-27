import { describe, expect, it, vi } from "vitest";
import {
	applyOverridesToChunk,
	computeWorldId,
	emptySaveData,
	parseSaveData,
	previewSourceLines,
	SAVE_SCHEMA_VERSION,
	withBagSlots,
	withFileOverride,
	withoutFileOverride,
	withPlayerPosition,
	withVisitedCluster,
} from "../src/systems/save.js";

describe("computeWorldId", () => {
	it("is deterministic for the same source + generatedAt", () => {
		const meta = {
			source: "/tmp/repo",
			generatedAt: "2026-09-24T00:00:00.000Z",
		};
		expect(computeWorldId(meta)).toBe(computeWorldId({ ...meta }));
	});

	it("differs when the source differs", () => {
		const a = computeWorldId({
			source: "/tmp/a",
			generatedAt: "2026-09-24T00:00:00.000Z",
		});
		const b = computeWorldId({
			source: "/tmp/b",
			generatedAt: "2026-09-24T00:00:00.000Z",
		});
		expect(a).not.toBe(b);
	});

	it("differs when the same source is reconverted at a different time", () => {
		const a = computeWorldId({
			source: "/tmp/a",
			generatedAt: "2026-09-24T00:00:00.000Z",
		});
		const b = computeWorldId({
			source: "/tmp/a",
			generatedAt: "2026-09-25T00:00:00.000Z",
		});
		expect(a).not.toBe(b);
	});
});

describe("parseSaveData", () => {
	it("round-trips a well-formed save", () => {
		const save = emptySaveData("abc123");
		expect(parseSaveData(JSON.parse(JSON.stringify(save)))).toEqual(save);
	});

	it("rejects an unknown/future version instead of throwing, warning once", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = parseSaveData({ ...emptySaveData("abc123"), version: 999 });
		expect(result).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("rejects structurally corrupt data instead of throwing", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(parseSaveData({ not: "a save" })).toBeNull();
		expect(parseSaveData("just a string")).toBeNull();
		expect(parseSaveData(null)).toBeNull();
		warn.mockRestore();
	});

	it("rejects an unknown extra field (strict schema)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const save = { ...emptySaveData("abc123"), extra: "nope" };
		expect(parseSaveData(save)).toBeNull();
		warn.mockRestore();
	});
});

describe("emptySaveData", () => {
	it("starts with every collection empty at the current schema version", () => {
		const save = emptySaveData("world-1");
		expect(save).toEqual({
			version: SAVE_SCHEMA_VERSION,
			worldId: "world-1",
			fileOverrides: {},
			playerPositions: {},
			visitedClusters: [],
			bagSlots: [],
		});
	});
});

describe("save reducer ops", () => {
	it("withFileOverride adds an override without disturbing others", () => {
		let save = emptySaveData("w");
		save = withFileOverride(
			save,
			"a.ts",
			"content a",
			"2026-09-24T00:00:00.000Z",
		);
		save = withFileOverride(
			save,
			"b.ts",
			"content b",
			"2026-09-24T00:00:01.000Z",
		);
		expect(save.fileOverrides).toEqual({
			"a.ts": { content: "content a", savedAt: "2026-09-24T00:00:00.000Z" },
			"b.ts": { content: "content b", savedAt: "2026-09-24T00:00:01.000Z" },
		});
	});

	it("withFileOverride replaces a re-saved file's override", () => {
		let save = emptySaveData("w");
		save = withFileOverride(save, "a.ts", "v1", "t1");
		save = withFileOverride(save, "a.ts", "v2", "t2");
		expect(save.fileOverrides["a.ts"]).toEqual({
			content: "v2",
			savedAt: "t2",
		});
	});

	it("withoutFileOverride drops exactly the named override", () => {
		let save = emptySaveData("w");
		save = withFileOverride(save, "a.ts", "va", "t");
		save = withFileOverride(save, "b.ts", "vb", "t");
		save = withoutFileOverride(save, "a.ts");
		expect(save.fileOverrides).toEqual({
			"b.ts": { content: "vb", savedAt: "t" },
		});
	});

	it("withoutFileOverride is a no-op for a portal with no override", () => {
		const save = emptySaveData("w");
		expect(withoutFileOverride(save, "missing.ts")).toEqual(save);
	});

	it("withPlayerPosition sets one scene key's position independently of others", () => {
		let save = emptySaveData("w");
		save = withPlayerPosition(save, "world", { x: 1, y: 2 });
		save = withPlayerPosition(save, "file:a.ts", { x: 3, y: 4 });
		expect(save.playerPositions).toEqual({
			world: { x: 1, y: 2 },
			"file:a.ts": { x: 3, y: 4 },
		});
	});

	it("withVisitedCluster appends a new cluster id once", () => {
		let save = emptySaveData("w");
		save = withVisitedCluster(save, "root");
		save = withVisitedCluster(save, "root");
		save = withVisitedCluster(save, "root--src");
		expect(save.visitedClusters).toEqual(["root", "root--src"]);
	});

	it("withBagSlots replaces the whole bag-slot snapshot", () => {
		let save = emptySaveData("w");
		const slots = [
			{ id: "1", text: "x", sourcePortalId: "a.ts", startLine: 0, endLine: 0 },
		];
		save = withBagSlots(save, slots);
		expect(save.bagSlots).toEqual(slots);
		expect(save.bagSlots).not.toBe(slots); // copied, not aliased
	});
});

describe("applyOverridesToChunk", () => {
	it("leaves files with no override untouched", () => {
		const files = { "a.ts": "original a", "b.ts": "original b" };
		const result = applyOverridesToChunk(files, new Map([["p-a", "a.ts"]]), {});
		expect(result).toEqual(files);
	});

	it("substitutes override content for the matching path only", () => {
		const files = { "a.ts": "original a", "b.ts": "original b" };
		const portalPathById = new Map([
			["p-a", "a.ts"],
			["p-b", "b.ts"],
		]);
		const result = applyOverridesToChunk(files, portalPathById, {
			"p-a": { content: "edited a", savedAt: "t" },
		});
		expect(result).toEqual({ "a.ts": "edited a", "b.ts": "original b" });
	});

	it("never mutates the input files record", () => {
		const files = { "a.ts": "original" };
		const result = applyOverridesToChunk(files, new Map([["p-a", "a.ts"]]), {
			"p-a": { content: "edited", savedAt: "t" },
		});
		expect(files).toEqual({ "a.ts": "original" });
		expect(result).not.toBe(files);
	});

	it("ignores an override whose portal isn't in this chunk's path map", () => {
		const files = { "a.ts": "original" };
		const result = applyOverridesToChunk(files, new Map(), {
			"p-other": { content: "edited", savedAt: "t" },
		});
		expect(result).toEqual(files);
	});

	it("ignores an override for a path not present in this chunk's files", () => {
		const files = { "a.ts": "original" };
		const portalPathById = new Map([["p-b", "b.ts"]]); // b.ts belongs to a different, not-yet-loaded chunk
		const result = applyOverridesToChunk(files, portalPathById, {
			"p-b": { content: "edited", savedAt: "t" },
		});
		expect(result).toEqual(files);
	});
});

describe("previewSourceLines", () => {
	const fallback = ["line one", "line two"];

	it("falls back to the manifest-baked preview when there's no override", () => {
		expect(previewSourceLines("p-a", fallback, {})).toBe(fallback);
	});

	it("uses the override's own lines when one exists", () => {
		const result = previewSourceLines("p-a", fallback, {
			"p-a": { content: "edited one\nedited two\nedited three", savedAt: "t" },
		});
		expect(result).toEqual(["edited one", "edited two", "edited three"]);
	});

	it("only substitutes for the matching portal id", () => {
		const result = previewSourceLines("p-a", fallback, {
			"p-b": { content: "not this one", savedAt: "t" },
		});
		expect(result).toBe(fallback);
	});
});
