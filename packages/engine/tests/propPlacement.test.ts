import { describe, expect, test } from "vitest";
import type { PropName } from "../src/assetPaths.js";
import {
	assignCappedPropNames,
	PROP_MAX_PER_CLEARING,
} from "../src/render/propPlacement.js";

const POOL: PropName[] = ["well", "bench", "bush", "fence"];

describe("assignCappedPropNames", () => {
	test("keeps uncapped picks exactly as the scatter variant chose them", () => {
		expect(assignCappedPropNames([2, 3, 2, 3], POOL)).toEqual([
			"bush",
			"fence",
			"bush",
			"fence",
		]);
	});

	test("never places more than one well or bench in a clearing", () => {
		const names = assignCappedPropNames([0, 0, 0, 1, 1, 0], POOL);
		expect(names.filter((n) => n === "well")).toHaveLength(1);
		expect(names.filter((n) => n === "bench")).toHaveLength(1);
		expect(names).toHaveLength(6);
	});

	test("a capped pick moves to the next name in the pool under its cap", () => {
		expect(assignCappedPropNames([0, 0], POOL)).toEqual(["well", "bench"]);
		expect(assignCappedPropNames([0, 0, 1], POOL)).toEqual([
			"well",
			"bench",
			"bush",
		]);
	});

	test("is deterministic", () => {
		const variants = [0, 1, 0, 1, 2, 0, 3];
		expect(assignCappedPropNames(variants, POOL)).toEqual(
			assignCappedPropNames(variants, POOL),
		);
	});

	test("falls back to the original pick when every name in the pool is capped out", () => {
		expect(assignCappedPropNames([0, 0], ["well"])).toEqual(["well", "well"]);
	});

	test("caps wells and benches by default", () => {
		expect(PROP_MAX_PER_CLEARING.well).toBe(1);
		expect(PROP_MAX_PER_CLEARING.bench).toBe(1);
	});
});
