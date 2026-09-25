import { describe, expect, it } from "vitest";
import {
	extendSelection,
	selectionRange,
	startSelection,
} from "../src/systems/selection.js";

describe("startSelection", () => {
	it("anchors and focuses on the same line", () => {
		expect(startSelection(10)).toEqual({ anchor: 10, focus: 10 });
	});
});

describe("extendSelection", () => {
	it("moves focus down", () => {
		expect(extendSelection({ anchor: 5, focus: 5 }, 2, 100)).toEqual({
			anchor: 5,
			focus: 7,
		});
	});

	it("moves focus up, past the anchor, growing the range on the other side", () => {
		expect(extendSelection({ anchor: 5, focus: 5 }, -8, 100)).toEqual({
			anchor: 5,
			focus: 0,
		});
	});

	it("clamps focus at 0", () => {
		expect(extendSelection({ anchor: 2, focus: 1 }, -5, 100)).toEqual({
			anchor: 2,
			focus: 0,
		});
	});

	it("clamps focus at totalLines - 1", () => {
		expect(extendSelection({ anchor: 2, focus: 8 }, 5, 10)).toEqual({
			anchor: 2,
			focus: 9,
		});
	});
});

describe("selectionRange", () => {
	it("normalizes when anchor <= focus", () => {
		expect(selectionRange({ anchor: 3, focus: 6 })).toEqual({
			start: 3,
			end: 6,
		});
	});

	it("normalizes when focus < anchor", () => {
		expect(selectionRange({ anchor: 6, focus: 3 })).toEqual({
			start: 3,
			end: 6,
		});
	});

	it("handles a single-line selection", () => {
		expect(selectionRange({ anchor: 4, focus: 4 })).toEqual({
			start: 4,
			end: 4,
		});
	});
});
