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
	const jsonFile = file("config.json", { language: "json", kind: "config" });

	/** The monster the build would spawn for `code` in `content` — rules come from the annotators, never hand-written. */
	function found(code: ErrorCode, f: PortalFile, content: string) {
		const hit = annotateFileLive(f, content, new Set([f.path])).find(
			(r) => r.code === code,
		);
		if (!hit) throw new Error(`no ${code} in fixture`);
		return { code, rule: hit.rule };
	}

	// 2026-09-29: these five used to bake line:col into the rule, so any line
	// inserted above counted as a fix. Each case: the bug moved down is still
	// there; the bug actually fixed is gone.
	const cases: {
		code: ErrorCode;
		f: PortalFile;
		broken: string;
		fixed: string;
	}[] = [
		{
			code: "NullTypeError",
			f: file("src/a.ts"),
			broken: 'import { helper } from "./missing.js";\nhelper();\n',
			fixed: "export const x = 1;\n",
		},
		{
			code: "IoError",
			f: file("src/a.ts"),
			broken: "export const x = (1 + 2\n",
			fixed: "export const x = (1 + 2)\n",
		},
		{
			code: "Corrupted",
			f: jsonFile,
			broken: '{\n  "a": 1,\n}\n',
			fixed: '{"a": 1}',
		},
		{
			code: "WispNote",
			f: file("src/a.ts"),
			broken: "// TODO: later\nexport const x = 1;\n",
			fixed: "// done\nexport const x = 1;\n",
		},
		{
			code: "InvalidMode",
			f: file("notes.txt", { kind: "text", language: undefined }),
			broken: "caf� au lait\n",
			fixed: "café au lait\n",
		},
	];

	for (const { code, f, broken, fixed } of cases) {
		it(`${code}: lines inserted above don't fix it; fixing the problem does`, () => {
			const monster = found(code, f, broken);
			expect(monster.rule).not.toMatch(/@\d+:\d+/);
			const worldFiles = new Set([f.path]);
			expect(checkMonsterFixed(monster, f, broken, worldFiles)).toBe(false);
			expect(checkMonsterFixed(monster, f, `\n\n\n${broken}`, worldFiles)).toBe(
				false,
			);
			expect(checkMonsterFixed(monster, f, fixed, worldFiles)).toBe(true);
		});
	}

	it("NullTypeError: a second import of the same missing spec keeps the first one's monster alive", () => {
		const f = file("src/a.ts");
		const twice =
			'import { a } from "./missing.js";\nimport { b } from "./missing.js";\n';
		const rules = annotateFileLive(f, twice, new Set([f.path]))
			.filter((r) => r.code === "NullTypeError")
			.map((r) => r.rule);
		expect(rules).toEqual([
			"broken-import:./missing.js",
			"broken-import:./missing.js#2",
		]);
		expect(
			checkMonsterFixed(
				{ code: "NullTypeError", rule: "broken-import:./missing.js" },
				f,
				'import { b } from "./missing.js";\n',
				new Set([f.path]),
			),
		).toBe(false);
	});

	it("Corrupted: still broken while the file fails to parse, wherever and however it fails", () => {
		const monster = found("Corrupted", jsonFile, '{\n  "a": 1,\n}\n');
		expect(monster.rule).toBe("json-parse");
		const worldFiles = new Set([jsonFile.path]);
		expect(
			checkMonsterFixed(monster, jsonFile, '{"a": 1}\n{', worldFiles),
		).toBe(false);
		expect(checkMonsterFixed(monster, jsonFile, "[1, 2", worldFiles)).toBe(
			false,
		);
		expect(checkMonsterFixed(monster, jsonFile, "[1, 2]", worldFiles)).toBe(
			true,
		);
	});

	it("WispNote: rewording the note is a different note", () => {
		const f = file("src/a.ts");
		const monster = found("WispNote", f, "// TODO: later\n");
		expect(
			checkMonsterFixed(monster, f, "// TODO: sooner\n", new Set([f.path])),
		).toBe(true);
		expect(
			checkMonsterFixed(
				monster,
				f,
				"\n//   TODO:   later\n",
				new Set([f.path]),
			),
		).toBe(false);
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

	it("a wisp moved down by blank lines survives on its new line; removing the TODO fixes it", () => {
		const wisp = monsterFrom(
			"// TODO: prune\nexport const y = 2;\n",
			"WispNote",
		);
		const moved = relocateMonsters(
			[wisp],
			file("src/a.ts"),
			"\n\n// TODO: prune\nexport const y = 2;\n",
			worldFiles,
		);
		expect(moved.fixedIds).toEqual([]);
		expect(moved.monsters[0]?.error.loc?.line).toBe(2);
		const removed = relocateMonsters(
			[wisp],
			file("src/a.ts"),
			"export const y = 2;\n",
			worldFiles,
		);
		expect(removed.fixedIds).toEqual([wisp.id]);
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
