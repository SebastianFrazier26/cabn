import { describe, expect, test } from "vitest";
import {
	checkExternalFindingFixed,
	classifyFinding,
	type ExternalFinding,
	externalFindingMessage,
	externalFindingRule,
	FindingsValidationError,
	fromEslintJson,
	fromSarif,
	parseFindingsFile,
	resolveFindingPath,
} from "../../src/annotate/externalFindings.js";

const eslintOutput = [
	{
		filePath: "/work/proj/src/app.ts",
		messages: [
			{
				ruleId: "no-unused-vars",
				severity: 2,
				message: "'x' is defined but never used.",
				line: 3,
				column: 7,
			},
			{
				ruleId: "eqeqeq",
				severity: 1,
				message: "Expected '===' and instead saw '=='.",
				line: 5,
				column: 9,
			},
			{ ruleId: "semi", severity: 0, message: "off", line: 1, column: 1 },
			{
				ruleId: null,
				fatal: true,
				severity: 2,
				message: "Parsing error: Unexpected token",
				line: 9,
				column: 2,
			},
		],
		errorCount: 2,
	},
];

const sarifLog = {
	version: "2.1.0",
	$schema: "https://json.schemastore.org/sarif-2.1.0.json",
	runs: [
		{
			tool: {
				driver: {
					name: "CodeQL",
					rules: [
						{
							id: "js/hardcoded-credentials",
							properties: { tags: ["security", "external/cwe/cwe-798"] },
						},
						{ id: "js/sql-injection", properties: { tags: ["security"] } },
					],
				},
			},
			originalUriBaseIds: { SRCROOT: { uri: "file:///work/proj/" } },
			results: [
				{
					ruleId: "js/sql-injection",
					message: { text: "This query depends on a user-provided value." },
					locations: [
						{
							physicalLocation: {
								artifactLocation: { uri: "src/db.ts", uriBaseId: "SRCROOT" },
								region: { startLine: 12, startColumn: 5 },
							},
						},
					],
				},
				{
					ruleId: "js/hardcoded-credentials",
					message: {
						text: "The hard-coded value 'hunter2-supersecret' is used as a password.",
					},
					locations: [
						{
							physicalLocation: {
								artifactLocation: { uri: "file:///work/proj/src/config.ts" },
								region: { startLine: 2 },
							},
						},
					],
				},
				{ ruleId: "js/no-location", message: { text: "whole-repo finding" } },
			],
		},
	],
};

describe("fromEslintJson / fromSarif", () => {
	test("ESLint JSON: 1-based -> 0-based, severity 0 skipped, fatal parse errors kept", () => {
		const findings = fromEslintJson(eslintOutput);
		expect(findings.map((f) => [f.ruleId, f.line, f.col, f.fatal])).toEqual([
			["no-unused-vars", 2, 6, false],
			["eqeqeq", 4, 8, false],
			["parse-error", 8, 1, true],
		]);
	});

	test("SARIF: resolves uriBaseId, carries rule tags, skips results with no location", () => {
		const findings = fromSarif(sarifLog);
		expect(findings.map((f) => [f.tool, f.ruleId, f.path, f.line])).toEqual([
			["CodeQL", "js/sql-injection", "file:///work/proj/src/db.ts", 11],
			[
				"CodeQL",
				"js/hardcoded-credentials",
				"file:///work/proj/src/config.ts",
				1,
			],
		]);
		expect(findings[1]?.tags).toContain("external/cwe/cwe-798");
	});

	test("parseFindingsFile auto-detects the format and rejects anything else at the boundary", () => {
		expect(parseFindingsFile(eslintOutput)).toHaveLength(3);
		expect(parseFindingsFile(sarifLog)).toHaveLength(2);
		for (const bad of [
			{ nope: true },
			"string",
			null,
			[{ filePath: 42, messages: [] }],
			[{ filePath: "a.ts", messages: [{ severity: 7, message: "x" }] }],
			{ runs: [{ tool: {} }] },
		]) {
			expect(() => parseFindingsFile(bad)).toThrow(FindingsValidationError);
		}
	});
});

describe("resolveFindingPath", () => {
	const world = new Set([
		"src/app.ts",
		"src/db.ts",
		"lib/index.ts",
		"pkg/index.ts",
	]);

	test.each([
		["/work/proj/src/app.ts", "/work/proj", "src/app.ts"],
		["file:///work/proj/src/db.ts", "/work/proj/", "src/db.ts"],
		["./src/app.ts", undefined, "src/app.ts"],
		["src\\app.ts", undefined, "src/app.ts"],
		["file:///C:/work/proj/src/db.ts", "C:\\work\\proj", "src/db.ts"],
		["/ci/runner/checkout/src/app.ts", "/elsewhere", "src/app.ts"],
		["/ci/checkout/src/my%20app.ts", undefined, undefined],
		["/ci/checkout/index.ts", undefined, undefined],
		["/ci/checkout/lib/index.ts", undefined, "lib/index.ts"],
		["src/missing.ts", undefined, undefined],
	])("%s (root %s) -> %s", (raw, root, expected) => {
		expect(resolveFindingPath(raw, world, root)).toBe(expected);
	});
});

describe("classifyFinding", () => {
	const f = (
		ruleId: string,
		extra: Partial<ExternalFinding> = {},
	): ExternalFinding => ({
		tool: "eslint",
		ruleId,
		path: "a.ts",
		line: 0,
		col: 0,
		message: "",
		fatal: false,
		tags: [],
		...extra,
	});

	test.each([
		["no-unused-vars", "DeadCode"],
		["@typescript-eslint/no-unused-vars", "DeadCode"],
		["no-unreachable", "DeadCode"],
		["F401", "DeadCode"],
		["F841", "DeadCode"],
		["no-console", "CodeSmell"],
		["no-debugger", "CodeSmell"],
		["complexity", "CodeSmell"],
		["max-depth", "CodeSmell"],
		["C901", "CodeSmell"],
		["sonarjs/no-duplicate-string", "CodeSmell"],
		["E999", "SyntaxError"],
		["import/no-unresolved", "NullTypeError"],
		["F821", "NullTypeError"],
		["import/no-cycle", "OuroborosError"],
		["no-warning-comments", "WispNote"],
		["js/hardcoded-credentials", "LeakedSecret"],
		["generic-api-key", "LeakedSecret"],
		["eqeqeq", "UnknownBug"],
		["js/sql-injection", "UnknownBug"],
	])("%s -> %s", (ruleId, code) => {
		expect(classifyFinding(f(ruleId))).toBe(code);
	});

	test("fatal findings are syntax errors; secret scanners and CWE tags are secrets", () => {
		expect(classifyFinding(f("parse-error", { fatal: true }))).toBe(
			"SyntaxError",
		);
		expect(classifyFinding(f("rule-1", { tool: "gitleaks" }))).toBe(
			"LeakedSecret",
		);
		expect(classifyFinding(f("x", { tags: ["external/cwe/cwe-798"] }))).toBe(
			"LeakedSecret",
		);
	});
});

describe("external finding messages, rules and re-checks", () => {
	const finding: ExternalFinding = {
		tool: "CodeQL",
		ruleId: "js/hardcoded-credentials",
		path: "src/config.ts",
		line: 1,
		col: 0,
		message:
			"The hard-coded value 'hunter2-supersecret' is used as a password.",
		fatal: false,
		tags: [],
	};

	test("a secret finding's message never repeats the scanner's text (which quotes the value)", () => {
		const msg = externalFindingMessage(finding, "LeakedSecret");
		expect(msg).not.toContain("hunter2");
		expect(msg).toContain("CodeQL js/hardcoded-credentials");
		const other = externalFindingMessage(
			{ ...finding, message: "x ".repeat(500) },
			"UnknownBug",
		);
		expect(other.length).toBeLessThanOrEqual(240);
	});

	test("counts as fixed once the flagged line's text is gone from the file", () => {
		const content =
			"export const a = 1;\nconst password = 'hunter2-supersecret';\n";
		const rule = externalFindingRule(finding, content);
		expect(rule).toMatch(/^ext:CodeQL:js\/hardcoded-credentials:[0-9a-f]{8}$/);
		expect(rule).not.toContain("hunter2");
		expect(checkExternalFindingFixed(rule, content)).toBe(false);
		expect(checkExternalFindingFixed(rule, `// moved\n${content}`)).toBe(false);
		expect(checkExternalFindingFixed(`${rule}#2`, content)).toBe(false);
		expect(
			checkExternalFindingFixed(
				rule,
				"export const a = 1;\nconst password = process.env.PW;\n",
			),
		).toBe(true);
	});
});
