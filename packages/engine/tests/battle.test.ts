import { externalFindingRule } from "@cabn/converter/core";
import type { ErrorCode, Monster, PortalFile } from "@cabn/world-schema";
import { describe, expect, it } from "vitest";
import {
	annotateFileLive,
	checkMonsterFixed,
	recheckMonster,
	relocateMonsters,
} from "../src/systems/battle.js";

function file(path: string, overrides: Partial<PortalFile> = {}): PortalFile {
	return {
		path,
		name: path.split("/").pop() ?? path,
		kind: "code",
		language: "typescript",
		bytes: 0,
		binary: false,
		...overrides,
	};
}

describe("checkMonsterFixed", () => {
	it("NullTypeError: fixed once the broken import is removed", () => {
		const monster = {
			code: "NullTypeError" as const,
			rule: "broken-import:./missing.js@0:24",
		};
		const worldFiles = new Set(["src/a.ts"]);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				'import { helper } from "./missing.js";\n',
				worldFiles,
			),
		).toBe(false);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				"export const x = 1;\n",
				worldFiles,
			),
		).toBe(true);
	});

	it("NullTypeError: not fixed if a different broken import remains, even with the same rule text coincidentally absent", () => {
		const monster = {
			code: "NullTypeError" as const,
			rule: "broken-import:./missing.js@0:24",
		};
		const worldFiles = new Set(["src/a.ts"]);
		// The exact rule (same spec, same loc) is still present verbatim.
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				'import { helper } from "./missing.js";\n',
				worldFiles,
			),
		).toBe(false);
	});

	it("IoError: fixed once the unclosed bracket is closed", () => {
		const monster = {
			code: "IoError" as const,
			rule: "bracket:unclosed:(@0:10",
		};
		const worldFiles = new Set(["src/a.ts"]);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				"const x = (1 + 2\n",
				worldFiles,
			),
		).toBe(false);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				"const x = (1 + 2)\n",
				worldFiles,
			),
		).toBe(true);
	});

	it("Corrupted: fixed once the JSON parses", () => {
		const monster = { code: "Corrupted" as const, rule: "json-parse@2:0" };
		const jsonFile = file("config.json", { language: "json", kind: "config" });
		const worldFiles = new Set(["config.json"]);
		expect(
			checkMonsterFixed(monster, jsonFile, '{\n  "a": 1,\n}\n', worldFiles),
		).toBe(false);
		expect(checkMonsterFixed(monster, jsonFile, '{"a": 1}', worldFiles)).toBe(
			true,
		);
	});

	it("WispNote: fixed once the TODO comment is removed", () => {
		const monster = { code: "WispNote" as const, rule: "todo:TODO@0:3" };
		const worldFiles = new Set(["src/a.ts"]);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				"// TODO: later\n",
				worldFiles,
			),
		).toBe(false);
		expect(
			checkMonsterFixed(monster, file("src/a.ts"), "// done\n", worldFiles),
		).toBe(true);
	});

	it("OuroborosError: fixed once the file drops its import edge into the recorded cycle", () => {
		const monster = {
			code: "OuroborosError" as const,
			rule: "circular-import:src/a.ts,src/b.ts",
		};
		const worldFiles = new Set(["src/a.ts", "src/b.ts"]);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				'import { b } from "./b.js";\n',
				worldFiles,
			),
		).toBe(false);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				"export const a = 1;\n",
				worldFiles,
			),
		).toBe(true);
	});

	it("OuroborosError: an import to something outside the recorded cycle doesn't count as still-broken", () => {
		const monster = {
			code: "OuroborosError" as const,
			rule: "circular-import:src/a.ts,src/b.ts",
		};
		const worldFiles = new Set(["src/a.ts", "src/b.ts", "src/c.ts"]);
		expect(
			checkMonsterFixed(
				monster,
				file("src/a.ts"),
				'import { c } from "./c.js";\n',
				worldFiles,
			),
		).toBe(true);
	});
});

describe("annotateFileLive", () => {
	it("aggregates every per-file annotator's hits against one buffer", () => {
		const worldFiles = new Set(["src/a.ts"]);
		const results = annotateFileLive(
			file("src/a.ts"),
			'import { helper } from "./missing.js"; // TODO: fix\nconst x = (1 + 2\n',
			worldFiles,
		);
		const codes = results.map((r) => r.code).sort();
		// DeadCode x2: `helper` and `x` are never used (M10 skeletons).
		expect(codes).toEqual([
			"DeadCode",
			"DeadCode",
			"IoError",
			"NullTypeError",
			"WispNote",
		]);
	});

	it("returns no results for a clean file", () => {
		const worldFiles = new Set(["src/a.ts"]);
		expect(
			annotateFileLive(file("src/a.ts"), "export const x = 1;\n", worldFiles),
		).toEqual([]);
	});
});

describe("relocateMonsters (re-entering a file with saved edits)", () => {
	const worldFiles = new Set(["src/a.ts", "src/b.ts"]);
	const original = "const stale = 1;\nexport const y = 2;\n";

	function monsterFrom(content: string, code: ErrorCode): Monster {
		const hit = annotateFileLive(file("src/a.ts"), content, worldFiles).find(
			(r) => r.code === code,
		);
		if (!hit) throw new Error(`no ${code} in fixture`);
		return {
			id: `monster:${code}`,
			portalId: "src/a.ts",
			species: hit.species,
			error: {
				code: hit.code,
				rule: hit.rule,
				message: hit.message,
				...(hit.loc ? { loc: hit.loc } : {}),
			},
			tier: hit.tier,
		};
	}

	it("moves a surviving monster to the line its bug is on in the saved text", () => {
		const dead = monsterFrom(original, "DeadCode");
		expect(dead.error.loc?.line).toBe(0);
		const saved = `// one\n// two\n// three\n${original}`;
		const { monsters, fixedIds } = relocateMonsters(
			[dead],
			file("src/a.ts"),
			saved,
			worldFiles,
		);
		expect(fixedIds).toEqual([]);
		expect(monsters).toHaveLength(1);
		expect(monsters[0]?.id).toBe(dead.id);
		expect(monsters[0]?.error.loc?.line).toBe(3);
		expect(dead.error.loc?.line).toBe(0); // the manifest's monster isn't mutated
	});

	it("reports monsters the saved text fixed, with the same verdict a save gives", () => {
		const dead = monsterFrom(original, "DeadCode");
		const saved = "export const stale = 1;\nexport const y = 2;\n";
		expect(
			checkMonsterFixed(
				{ code: dead.error.code, rule: dead.error.rule },
				file("src/a.ts"),
				saved,
				worldFiles,
			),
		).toBe(true);
		const { monsters, fixedIds } = relocateMonsters(
			[dead],
			file("src/a.ts"),
			saved,
			worldFiles,
		);
		expect(monsters).toEqual([]);
		expect(fixedIds).toEqual([dead.id]);
	});

	it("never disagrees with a save's verdict, even for a loc-keyed rule", () => {
		const wisp = monsterFrom(
			"// TODO: prune\nexport const y = 2;\n",
			"WispNote",
		);
		for (const saved of [
			"// TODO: prune\nexport const y = 2;\n",
			"\n\n// TODO: prune\nexport const y = 2;\n",
			"export const y = 2;\n",
		]) {
			const saveVerdict = checkMonsterFixed(
				{ code: wisp.error.code, rule: wisp.error.rule },
				file("src/a.ts"),
				saved,
				worldFiles,
			);
			const { fixedIds } = relocateMonsters(
				[wisp],
				file("src/a.ts"),
				saved,
				worldFiles,
			);
			expect(fixedIds.includes(wisp.id)).toBe(saveVerdict);
		}
	});

	it("follows an ouroboros to its import's new line", () => {
		const cycle: Monster = {
			id: "monster:cycle",
			portalId: "src/a.ts",
			species: "ouroboros",
			error: {
				code: "OuroborosError",
				rule: "circular-import:src/a.ts,src/b.ts",
				message: "cycle",
				loc: { line: 0, col: 18 },
			},
			tier: 1,
		};
		const saved = `// header\n\nimport { b } from "./b.js";\nexport const a = b;\n`;
		const { monsters, fixedIds } = relocateMonsters(
			[cycle],
			file("src/a.ts"),
			saved,
			worldFiles,
		);
		expect(fixedIds).toEqual([]);
		expect(monsters[0]?.error.loc?.line).toBe(2);
	});

	it("follows an external finding to the line its flagged text moved to", () => {
		const content = "export const a = 1;\nconst password = 'hunter2-x';\n";
		const rule = externalFindingRule(
			{
				tool: "CodeQL",
				ruleId: "js/hardcoded-credentials",
				message: "hard-coded credential",
				path: "src/a.ts",
				line: 1,
				col: 0,
				fatal: false,
				tags: [],
			},
			content,
		);
		const ext: Monster = {
			id: "monster:ext",
			portalId: "src/a.ts",
			species: "shade",
			error: {
				code: "UnknownBug",
				rule,
				message: "x",
				loc: { line: 1, col: 0 },
			},
			tier: 1,
		};
		const { monsters } = relocateMonsters(
			[ext],
			file("src/a.ts"),
			`// moved\n// down\n${content}`,
			worldFiles,
		);
		expect(monsters[0]?.error.loc?.line).toBe(3);
	});

	it("recheckMonster reports where the cycle's import is", () => {
		expect(
			recheckMonster(
				{ code: "OuroborosError", rule: "circular-import:src/a.ts,src/b.ts" },
				file("src/a.ts"),
				'import { b } from "./b.js";\n',
				worldFiles,
			),
		).toEqual({ fixed: false, loc: { line: 0, col: 19 } });
	});
});
