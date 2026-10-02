import type { ErrorAnnotation } from "@cabn/converter/browser";
import { describe, expect, test } from "vitest";
import {
	mapSpellbookErrorRows,
	spellbookStatusLine,
	toSpellbookErrorRows,
} from "../src/systems/spellbookStatus.js";

describe("spellbookStatusLine", () => {
	test("reports saved/unsaved, run status, and a zero error count", () => {
		expect(
			spellbookStatusLine({ dirty: false, runStatus: "idle", errorCount: 0 }),
		).toEqual({
			saveLabel: "saved",
			runStatus: "idle",
			errorCount: 0,
			summary: "saved · not run · no errors",
		});
	});

	test("singular vs. plural error wording", () => {
		expect(
			spellbookStatusLine({ dirty: true, runStatus: "playing", errorCount: 1 })
				.summary,
		).toBe("unsaved · running · 1 error");
		expect(
			spellbookStatusLine({ dirty: true, runStatus: "playing", errorCount: 3 })
				.summary,
		).toBe("unsaved · running · 3 errors");
	});

	test.each([
		["idle", "not run"],
		["playing", "running"],
		["paused", "paused"],
		["blocked", "blocked"],
		["done", "finished"],
	] as const)("labels run status %s as %s", (runStatus, label) => {
		expect(
			spellbookStatusLine({ dirty: false, runStatus, errorCount: 0 }).summary,
		).toContain(label);
	});
});

function annotation(
	overrides: Partial<ErrorAnnotation> & Pick<ErrorAnnotation, "message">,
): ErrorAnnotation {
	return {
		code: "IoError",
		rule: "test-rule",
		species: "gremlin",
		tier: 1,
		...overrides,
	};
}

describe("toSpellbookErrorRows", () => {
	test("converts 0-based loc.line to a 1-based displayLine", () => {
		const rows = toSpellbookErrorRows([
			annotation({ message: "unbalanced bracket", loc: { line: 4, col: 0 } }),
		]);
		expect(rows[0]?.line).toBe(4);
		expect(rows[0]?.displayLine).toBe(5);
	});

	test("sorts by line ascending, independent of input order", () => {
		const rows = toSpellbookErrorRows([
			annotation({ message: "b", loc: { line: 9, col: 0 } }),
			annotation({ message: "a", loc: { line: 2, col: 0 } }),
			annotation({ message: "c", loc: { line: 5, col: 0 } }),
		]);
		expect(rows.map((r) => r.message)).toEqual(["a", "c", "b"]);
	});

	test("sinks annotations with no location to the bottom", () => {
		const rows = toSpellbookErrorRows([
			annotation({ message: "no-loc" }),
			annotation({ message: "has-loc", loc: { line: 0, col: 0 } }),
		]);
		expect(rows.map((r) => r.message)).toEqual(["has-loc", "no-loc"]);
		expect(rows[1]?.displayLine).toBeNull();
	});

	test("keys stay unique across duplicate code/rule pairs", () => {
		const rows = toSpellbookErrorRows([
			annotation({ message: "first", rule: "same", loc: { line: 0, col: 0 } }),
			annotation({ message: "second", rule: "same", loc: { line: 1, col: 0 } }),
		]);
		expect(new Set(rows.map((r) => r.key)).size).toBe(2);
	});

	test("empty input yields an empty list", () => {
		expect(toSpellbookErrorRows([])).toEqual([]);
	});
});

describe("mapSpellbookErrorRows", () => {
	const rows = toSpellbookErrorRows([
		annotation({ message: "located", loc: { line: 2, col: 0 } }),
		annotation({ message: "no-loc" }),
	]);

	test("moves each located row to its mapped line and relabels it", () => {
		const mapped = mapSpellbookErrorRows(rows, (line) => line + 3);
		expect(mapped[0]).toMatchObject({ line: 5, displayLine: 6 });
		expect(mapped[1]).toBe(rows[1]);
	});

	test("keeps unmoved rows by identity", () => {
		expect(mapSpellbookErrorRows(rows, (line) => line)[0]).toBe(rows[0]);
	});
});
