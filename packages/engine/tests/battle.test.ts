import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, it } from "vitest";
import { annotateFileLive, checkMonsterFixed } from "../src/systems/battle.js";

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
