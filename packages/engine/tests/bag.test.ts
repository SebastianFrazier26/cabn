import { describe, expect, it } from "vitest";
import { addBagSlot, type BagSlot, removeBagSlot } from "../src/systems/bag.js";

function slot(id: string): BagSlot {
	return {
		id,
		text: `text-${id}`,
		sourcePortalId: "src/index.ts",
		startLine: 0,
		endLine: 0,
	};
}

describe("addBagSlot", () => {
	it("appends to an empty bag", () => {
		expect(addBagSlot([], slot("a"))).toEqual([slot("a")]);
	});

	it("preserves insertion order under capacity", () => {
		const slots = addBagSlot(addBagSlot([], slot("a")), slot("b"));
		expect(slots.map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("evicts the oldest slot once past max, keeping FIFO order", () => {
		let slots = [slot("a"), slot("b"), slot("c"), slot("d"), slot("e")];
		slots = addBagSlot(slots, slot("f"), 5);
		expect(slots.map((s) => s.id)).toEqual(["b", "c", "d", "e", "f"]);
	});

	it("respects a custom max", () => {
		const slots = addBagSlot([slot("a")], slot("b"), 1);
		expect(slots.map((s) => s.id)).toEqual(["b"]);
	});
});

describe("removeBagSlot", () => {
	it("removes the matching slot by id", () => {
		const slots = removeBagSlot([slot("a"), slot("b")], "a");
		expect(slots.map((s) => s.id)).toEqual(["b"]);
	});

	it("is a no-op when the id isn't present", () => {
		const slots = [slot("a")];
		expect(removeBagSlot(slots, "z")).toEqual(slots);
	});
});
