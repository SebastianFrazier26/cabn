import { join } from "node:path";
import {
	type MonsterIndexFile,
	MonsterIndexFileSchema,
	mergeMonsterIndex,
	parseMonsterIndex,
	validateManifest,
	WORLD_JSON_ERROR_CODES,
	type WorldManifest,
} from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { fromEslintJson } from "../src/annotate/externalFindings.js";
import { SPECIES_BY_ERROR_CODE } from "../src/annotate/taxonomy.js";
import { convert } from "../src/convert.js";
import { DirSource } from "../src/sources/dir.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "taxonomy-world");
const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

function entry<T>(bundle: Map<string, Uint8Array | string>, name: string): T {
	const raw = bundle.get(name);
	if (typeof raw !== "string") throw new Error(`missing ${name}`);
	return JSON.parse(raw) as T;
}

const LEGACY_SPECIES = new Set(
	WORLD_JSON_ERROR_CODES.map((code) => SPECIES_BY_ERROR_CODE[code]),
);

async function build(findings = true) {
	const eslint = [
		{
			filePath: join(FIXTURE, "src", "clean.ts"),
			messages: [
				{
					ruleId: "eqeqeq",
					severity: 2,
					message: "Expected '==='.",
					line: 4,
					column: 22,
				},
				{
					ruleId: "no-unused-vars",
					severity: 2,
					message: "unused",
					line: 1,
					column: 10,
				},
			],
		},
		{
			filePath: join(FIXTURE, "lib", "tidy.py"),
			messages: [
				// Same line + class as the built-in unused-import skeleton: dropped.
				{
					ruleId: "no-unused-vars",
					severity: 2,
					message: "'os' unused",
					line: 1,
					column: 8,
				},
			],
		},
		{
			filePath: "/elsewhere/not-in-world.ts",
			messages: [{ ruleId: "x", severity: 2, message: "?", line: 1 }],
		},
	];
	return convert(new DirSource(FIXTURE), {
		name: "taxonomy",
		source: FIXTURE,
		now: FIXED_NOW,
		...(findings ? { findings: fromEslintJson(eslint) } : {}),
	});
}

describe("M10 monster taxonomy end to end", () => {
	test("world.json keeps only codes every engine understands; new classes go to monsters.json", async () => {
		const bundle = await build();
		const world = validateManifest(entry<WorldManifest>(bundle, "world.json"));
		for (const m of world.monsters) {
			expect(WORLD_JSON_ERROR_CODES).toContain(m.error.code);
			expect(LEGACY_SPECIES.has(m.species)).toBe(true);
		}
		const worldIds = new Set(world.monsters.map((m) => m.id));
		for (const portal of world.portals) {
			for (const id of portal.spawns) expect(worldIds.has(id)).toBe(true);
		}

		const index = MonsterIndexFileSchema.parse(
			entry<MonsterIndexFile>(bundle, "monsters.json"),
		);
		const bySpecies = new Map<string, string[]>();
		for (const m of index.monsters) {
			expect(WORLD_JSON_ERROR_CODES).not.toContain(m.error.code);
			bySpecies.set(m.species, [
				...(bySpecies.get(m.species) ?? []),
				m.portalId ?? "",
			]);
		}
		expect(bySpecies.get("imp")).toEqual(["src/total.js"]);
		expect(bySpecies.get("magpie")).toEqual(["src/client.ts"]);
		expect(bySpecies.get("skeleton")?.sort()).toEqual([
			"lib/tidy.py",
			"lib/tidy.py",
			"src/clean.ts",
		]);
		// walk.js: deep nesting + console.log; tidy.py: a print() in library code.
		expect(bySpecies.get("bramble")?.sort()).toEqual([
			"lib/tidy.py",
			"src/walk.js",
			"src/walk.js",
		]);
		expect(bySpecies.get("shade")).toEqual(["src/clean.ts"]);
		expect(index.findings).toEqual({ ingested: 4, attached: 2, dropped: 2 });

		const tiers = Object.fromEntries(
			index.monsters.map((m) => [m.species, m.tier]),
		);
		expect(tiers).toMatchObject({
			imp: 2,
			magpie: 3,
			skeleton: 1,
			bramble: 1,
			shade: 1,
		});
		expect(JSON.stringify(index)).not.toContain("cabnFakeKeyForTheMagpie42");
	});

	test("the engine-side merge puts every monster back on its portal", async () => {
		const bundle = await build();
		const world = validateManifest(entry<WorldManifest>(bundle, "world.json"));
		const extra = parseMonsterIndex(entry(bundle, "monsters.json"));
		const merged = mergeMonsterIndex(world, extra);
		expect(merged.monsters).toHaveLength(world.monsters.length + extra.length);
		for (const m of merged.monsters) {
			if (!m.portalId) continue;
			expect(merged.portals.find((p) => p.id === m.portalId)?.spawns).toContain(
				m.id,
			);
		}
		expect(() => validateManifest(merged)).not.toThrow();
	});

	test("deterministic: same input, byte-identical world.json and monsters.json; no findings summary without findings", async () => {
		const [a, b] = await Promise.all([build(), build()]);
		expect(a.get("world.json")).toBe(b.get("world.json"));
		expect(a.get("monsters.json")).toBe(b.get("monsters.json"));
		const plain = entry<MonsterIndexFile>(await build(false), "monsters.json");
		expect(plain.findings).toBeUndefined();
		expect(plain.monsters.some((m) => m.species === "shade")).toBe(false);
	});

	test("cabn.json annotate thresholds reach the smell annotator", async () => {
		const { mkdtemp, cp, writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "cabn-taxonomy-"));
		try {
			await cp(FIXTURE, dir, { recursive: true });
			await writeFile(
				join(dir, "cabn.json"),
				JSON.stringify({
					cabnConfigVersion: 1,
					annotate: { maxNestingDepth: 6 },
				}),
			);
			const bundle = await convert(new DirSource(dir), {
				name: "t",
				source: dir,
				now: FIXED_NOW,
			});
			const index = entry<MonsterIndexFile>(bundle, "monsters.json");
			expect(
				index.monsters
					.map((m) => m.error.rule)
					.filter((r) => r.startsWith("deep-nesting")),
			).toEqual([]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
