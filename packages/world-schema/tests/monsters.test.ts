import { describe, expect, test } from "vitest";
import {
	CabnConfigSchema,
	ErrorCodeSchema,
	EXTENDED_ERROR_CODES,
	isWorldJsonErrorCode,
	type Monster,
	mergeMonsterIndex,
	parseMonsterIndex,
	SpeciesSchema,
	validateManifest,
	WORLD_JSON_ERROR_CODES,
	type WorldManifest,
} from "../src/index.js";

const manifest: WorldManifest = validateManifest({
	cabnVersion: 1,
	meta: {
		name: "w",
		source: "w",
		generatedAt: "2026-01-01T00:00:00.000Z",
		fileCount: 2,
		totalBytes: 2,
		truncated: false,
		skippedFiles: 0,
	},
	clusters: [
		{
			id: "root",
			path: ".",
			label: "w",
			pos: { x: 0, y: 0 },
			biome: "meadow",
			portalIds: ["a.ts"],
			chunk: "chunks/root.json",
		},
		{
			id: "src",
			path: "src",
			label: "src",
			pos: { x: 9, y: 9 },
			biome: "grove",
			portalIds: ["src/b.ts"],
			chunk: "chunks/src.json",
		},
	],
	paths: [{ from: "root", to: "src", kind: "trail" }],
	portals: [
		{
			id: "a.ts",
			clusterId: "root",
			file: {
				path: "a.ts",
				name: "a.ts",
				kind: "code",
				bytes: 1,
				binary: false,
			},
			preview: { lines: [], truncated: false },
			spawns: ["monster:old"],
		},
		{
			id: "src/b.ts",
			clusterId: "src",
			file: {
				path: "src/b.ts",
				name: "b.ts",
				kind: "code",
				bytes: 1,
				binary: false,
			},
			preview: { lines: [], truncated: false },
			spawns: [],
		},
	],
	monsters: [
		{
			id: "monster:old",
			portalId: "a.ts",
			species: "ghost",
			error: { code: "NullTypeError", rule: "r", message: "m" },
			tier: 1,
		},
	],
});

const imp = (id: string, extra: Partial<Monster> = {}): Monster => ({
	id,
	portalId: "src/b.ts",
	species: "imp",
	error: { code: "SyntaxError", rule: `syntax:ts:${id}`, message: "bad" },
	tier: 2,
	...extra,
});

describe("taxonomy enums", () => {
	test("the six world.json codes come first and are the only ones isWorldJsonErrorCode accepts", () => {
		expect(ErrorCodeSchema.options.slice(0, 6)).toEqual([
			...WORLD_JSON_ERROR_CODES,
		]);
		for (const code of WORLD_JSON_ERROR_CODES)
			expect(isWorldJsonErrorCode(code)).toBe(true);
		for (const code of EXTENDED_ERROR_CODES)
			expect(isWorldJsonErrorCode(code)).toBe(false);
		expect(SpeciesSchema.options).toEqual(
			expect.arrayContaining(["imp", "magpie", "skeleton", "bramble", "shade"]),
		);
	});
});

describe("monsters.json", () => {
	test("parseMonsterIndex never throws and drops entries this build doesn't understand", () => {
		for (const bad of [
			null,
			"x",
			{},
			{ monstersVersion: 2, monsters: [imp("a")] },
			{ monstersVersion: 1 },
		]) {
			expect(parseMonsterIndex(bad)).toEqual([]);
		}
		const parsed = parseMonsterIndex({
			monstersVersion: 1,
			monsters: [
				imp("a"),
				{ ...imp("b"), species: "basilisk" },
				{
					...imp("c"),
					error: { code: "FutureError", rule: "r", message: "m" },
				},
				{ ...imp("d"), tier: 9 },
				"garbage",
			],
		});
		expect(parsed.map((m) => m.id)).toEqual(["a"]);
	});

	test("mergeMonsterIndex appends to monsters and portal spawns, dropping collisions and dangling refs", () => {
		const merged = mergeMonsterIndex(manifest, [
			imp("monster:new"),
			imp("monster:old"),
			imp("monster:nowhere", { portalId: "gone.ts" }),
			imp("monster:path", { portalId: undefined, pathId: "root::src" }),
			imp("monster:badpath", { portalId: undefined, pathId: "src::nope" }),
		]);
		expect(merged.monsters.map((m) => m.id)).toEqual([
			"monster:old",
			"monster:new",
			"monster:path",
		]);
		expect(merged.portals.find((p) => p.id === "src/b.ts")?.spawns).toEqual([
			"monster:new",
		]);
		expect(merged.portals.find((p) => p.id === "a.ts")?.spawns).toEqual([
			"monster:old",
		]);
		expect(manifest.monsters).toHaveLength(1);
		expect(mergeMonsterIndex(manifest, [])).toBe(manifest);
	});
});

describe("cabn.json annotate thresholds", () => {
	test("optional, bounded, strict", () => {
		const base = { cabnConfigVersion: 1 };
		expect(CabnConfigSchema.parse(base).annotate).toBeUndefined();
		expect(
			CabnConfigSchema.parse({ ...base, annotate: { maxFunctionLines: 120 } })
				.annotate,
		).toEqual({
			maxFunctionLines: 120,
		});
		for (const annotate of [
			{ maxFunctionLines: 5 },
			{ maxNestingDepth: 50 },
			{ maxNestingDepth: 3.5 },
			{ other: 1 },
		]) {
			expect(CabnConfigSchema.safeParse({ ...base, annotate }).success).toBe(
				false,
			);
		}
	});
});
