import { describe, expect, test } from "vitest";
import {
	parseSignIndex,
	SEYN_MAX_BYTES,
	SIGN_INDEX_VERSION,
	SignIndexFileSchema,
} from "../src/index.js";

const good = {
	path: "docs/tour.seyn",
	source: "# Tour\n",
	anchor: { kind: "cluster", id: "docs" },
};

describe("signs.json", () => {
	test("strict schema accepts what the converter writes", () => {
		expect(
			SignIndexFileSchema.safeParse({
				signsVersion: SIGN_INDEX_VERSION,
				signs: [
					good,
					{ ...good, path: "a.seyn", anchor: { kind: "portal", id: "a.ts" } },
				],
			}).success,
		).toBe(true);
	});

	test.each([
		"/abs.seyn",
		"../up.seyn",
		"a//b.seyn",
		"a/./b.seyn",
		"notes.txt",
		"a\\b.seyn",
		"",
	])("rejects path %j", (path) => {
		expect(
			SignIndexFileSchema.safeParse({
				signsVersion: 1,
				signs: [{ ...good, path }],
			}).success,
		).toBe(false);
	});

	test("reader never throws and drops bad entries individually", () => {
		for (const junk of [
			undefined,
			null,
			3,
			"x",
			{},
			{ signsVersion: 2, signs: [good] },
			{ signsVersion: 1, signs: "no" },
		]) {
			expect(parseSignIndex(junk)).toEqual([]);
		}
		const out = parseSignIndex({
			signsVersion: 1,
			signs: [
				good,
				{ ...good }, // duplicate path
				{ ...good, path: "../x.seyn" },
				{ ...good, path: "big.seyn", source: "x".repeat(SEYN_MAX_BYTES + 1) },
				{ ...good, path: "b.seyn", anchor: { kind: "tower", id: "x" } },
				{
					...good,
					path: "c.seyn",
					future: true,
					anchor: { kind: "portal", id: "c.ts", extra: 1 },
				},
			],
		});
		expect(out).toEqual([
			good,
			{
				path: "c.seyn",
				source: good.source,
				anchor: { kind: "portal", id: "c.ts" },
			},
		]);
	});
});
