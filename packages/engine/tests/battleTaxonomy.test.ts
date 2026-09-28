import {
	codeSmell,
	deadCode,
	externalFindingRule,
	leakedSecret,
	syntaxError,
} from "@cabn/converter/browser";
import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, it } from "vitest";
import { checkMonsterFixed } from "../src/systems/battle.js";
import { speciesDisplayName } from "../src/systems/monsterDisplay.js";

function file(path: string, language: string): PortalFile {
	return {
		path,
		name: path.split("/").pop() ?? path,
		kind: "code",
		language,
		bytes: 0,
		binary: false,
	};
}

const ts = file("src/a.ts", "typescript");
const py = file("lib/m.py", "python");
const world = new Set([ts.path, py.path]);

describe("checkMonsterFixed — M10 classes", () => {
	it("SyntaxError: fixed by repairing the line, not by shifting it down", () => {
		const broken = "export const x = 1 + ;\n";
		const [imp] = syntaxError({ file: ts, content: broken, worldFiles: world });
		if (!imp) throw new Error("expected an imp");
		expect(checkMonsterFixed(imp, ts, `// moved\n${broken}`, world)).toBe(
			false,
		);
		expect(checkMonsterFixed(imp, ts, "export const x = 1 + 2;\n", world)).toBe(
			true,
		);
	});

	it("LeakedSecret: fixed once the literal is replaced by an env lookup", () => {
		const key = ["sk-", "ant-", "demo-cabnFakeKeyForTheMagpie42"].join("");
		const content = `export const key = "${key}";\n`;
		const [magpie] = leakedSecret({ file: ts, content, worldFiles: world });
		if (!magpie) throw new Error("expected a magpie");
		expect(checkMonsterFixed(magpie, ts, content, world)).toBe(false);
		expect(
			checkMonsterFixed(
				magpie,
				ts,
				"export const key = process.env.ANTHROPIC_API_KEY;\n",
				world,
			),
		).toBe(true);
	});

	it("DeadCode: fixed by using or deleting the import", () => {
		const content = "import os\nimport re\n\nprint(re)\n";
		const [skeleton] = deadCode({ file: py, content, worldFiles: world });
		if (!skeleton) throw new Error("expected a skeleton");
		expect(skeleton.rule).toBe("unused-import:os");
		expect(checkMonsterFixed(skeleton, py, content, world)).toBe(false);
		expect(
			checkMonsterFixed(skeleton, py, "import re\n\nprint(re)\n", world),
		).toBe(true);
	});

	it("CodeSmell: re-judged with the threshold recorded in its rule, not the default", () => {
		const body = Array.from({ length: 25 }, (_, i) => `  n += ${i};`).join(
			"\n",
		);
		const long = `export function f() {\n  let n = 0;\n${body}\n  return n;\n}\n`;
		const [bramble] = codeSmell({
			file: ts,
			content: long,
			worldFiles: world,
			options: { maxFunctionLines: 20 },
		});
		if (!bramble) throw new Error("expected a bramble");
		expect(bramble.rule).toBe("long-function:f:20");
		// Under the default 80-line limit this function is fine, so a default
		// re-check would wrongly call it fixed without any edit.
		expect(checkMonsterFixed(bramble, ts, long, world)).toBe(false);
		const short = "export function f() {\n  return 1;\n}\n";
		expect(checkMonsterFixed(bramble, ts, short, world)).toBe(true);
	});

	it("external findings (shade or mapped): fixed once the flagged line changes", () => {
		const content = "export const a = 1;\nif (a == '1') {}\n";
		const rule = externalFindingRule(
			{
				tool: "eslint",
				ruleId: "eqeqeq",
				path: ts.path,
				line: 1,
				col: 6,
				message: "",
				fatal: false,
				tags: [],
			},
			content,
		);
		const shade = { code: "UnknownBug" as const, rule };
		expect(checkMonsterFixed(shade, ts, content, world)).toBe(false);
		expect(
			checkMonsterFixed(
				shade,
				ts,
				"export const a = 1;\nif (a === '1') {}\n",
				world,
			),
		).toBe(true);
		// Mapped onto a built-in class, it still re-checks by its line, not by
		// that class's own annotator (which never produced this rule).
		expect(
			checkMonsterFixed({ code: "DeadCode", rule }, ts, content, world),
		).toBe(false);
	});
});

describe("speciesDisplayName", () => {
	it("names every new species", () => {
		expect(
			["imp", "magpie", "skeleton", "bramble", "shade"].map((s) =>
				speciesDisplayName(s as never),
			),
		).toEqual(["Hex Imp", "Magpie", "Skeleton", "Bramble", "Shade"]);
	});
});
