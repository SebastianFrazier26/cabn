import { describe, expect, it } from "vitest";
import { diffLines, minimalChange } from "../../src/pets/diff.js";
import { countOccurrences } from "../../src/pets/tools.js";
import {
	initialPetFollow,
	PET_FOLLOW,
	stepPetFollow,
} from "../../src/systems/petFollow.js";

describe("diffLines", () => {
	it("shows a one-line change with context and folds far-away lines into a gap", () => {
		const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
			"\n",
		);
		const after = before.replace("line 10", "line ten");
		const rows = diffLines(before, after, 2);
		expect(rows[0]).toEqual({ kind: "gap", hidden: 7 });
		expect(rows.filter((r) => r.kind === "del")).toEqual([
			{ kind: "del", oldLine: 10, text: "line 10" },
		]);
		expect(rows.filter((r) => r.kind === "add")).toEqual([
			{ kind: "add", newLine: 10, text: "line ten" },
		]);
		expect(rows.at(-1)).toEqual({ kind: "gap", hidden: 8 });
	});

	it("handles insertions and deletions with correct line numbers on both sides", () => {
		const rows = diffLines("a\nb\nc", "a\nx\ny\nc");
		expect(rows).toEqual([
			{ kind: "same", oldLine: 1, newLine: 1, text: "a" },
			{ kind: "add", newLine: 2, text: "x" },
			{ kind: "add", newLine: 3, text: "y" },
			{ kind: "del", oldLine: 2, text: "b" },
			{ kind: "same", oldLine: 3, newLine: 4, text: "c" },
		]);
	});

	it("identical text produces no rows", () => {
		expect(diffLines("same\ntext", "same\ntext")).toEqual([]);
	});
});

describe("minimalChange", () => {
	it("finds the smallest single replacement", () => {
		expect(minimalChange("const port = 3000;", "const port = 8080;")).toEqual({
			from: 13,
			to: 16,
			insert: "808",
		});
		expect(minimalChange("abc", "abXc")).toEqual({
			from: 2,
			to: 2,
			insert: "X",
		});
		expect(minimalChange("abc", "ac")).toEqual({ from: 1, to: 2, insert: "" });
	});
});

describe("countOccurrences", () => {
	it("counts non-overlapping matches", () => {
		expect(countOccurrences("aaaa", "aa")).toBe(2);
		expect(countOccurrences("abc", "z")).toBe(0);
		expect(countOccurrences("", "")).toBe(1);
	});
});

describe("pet follow", () => {
	it("trails behind the player's heading, lags, then settles", () => {
		let state = initialPetFollow({ x: 0, y: 0 });
		// Player walks right 100px over ~0.4s.
		for (let i = 1; i <= 25; i++)
			state = stepPetFollow(state, { x: i * 4, y: 0 }, 16);
		expect(state.moving).toBe(true);
		expect(state.pos.x).toBeLessThan(100 - PET_FOLLOW.trailDistance);
		expect(state.facingLeft).toBe(false);
		for (let i = 0; i < 200; i++)
			state = stepPetFollow(state, { x: 100, y: 0 }, 16);
		expect(state.moving).toBe(false);
		expect(
			Math.hypot(
				state.pos.x - (100 - PET_FOLLOW.trailDistance),
				state.pos.y - PET_FOLLOW.footOffsetY,
			),
		).toBeLessThanOrEqual(PET_FOLLOW.settleRadius);
	});

	it("turns to face the player walking left, and snaps after a teleport", () => {
		let state = initialPetFollow({ x: 100, y: 0 });
		for (let i = 1; i <= 30; i++)
			state = stepPetFollow(state, { x: 100 - i * 4, y: 0 }, 16);
		expect(state.facingLeft).toBe(true);
		state = stepPetFollow(state, { x: 5000, y: 5000 }, 16);
		expect(Math.hypot(state.pos.x - 5000, state.pos.y - 5000)).toBeLessThan(
			PET_FOLLOW.trailDistance * 2,
		);
	});

	it("never moves faster than its speed cap", () => {
		let state = initialPetFollow({ x: 0, y: 0 });
		const before = { ...state.pos };
		state = stepPetFollow(state, { x: 300, y: 0 }, 100);
		expect(
			Math.hypot(state.pos.x - before.x, state.pos.y - before.y),
		).toBeLessThanOrEqual(PET_FOLLOW.maxSpeedPxPerSec * 0.1 + 1e-6);
	});
});
