import { describe, expect, it } from "vitest";
import { labelAnchor, pickLabelSide } from "../src/systems/labelPlacement.js";

describe("pickLabelSide", () => {
	it("defaults to below with no paths", () => {
		expect(pickLabelSide([])).toBe("below");
	});

	it("moves above when the only path runs straight down (the shelf's north cabin)", () => {
		expect(pickLabelSide([{ x: 0, y: 480 }])).toBe("above");
	});

	it("stays below when the path runs up or sideways", () => {
		expect(pickLabelSide([{ x: 0, y: -480 }])).toBe("below");
		expect(pickLabelSide([{ x: 480, y: 0 }])).toBe("below");
		expect(pickLabelSide([{ x: 300, y: 250 }])).toBe("below");
	});

	it("goes beside when paths leave both straight up and straight down (the shelf tower with two cabins)", () => {
		expect(
			pickLabelSide([
				{ x: 0, y: 480 },
				{ x: 0, y: -480 },
			]),
		).toBe("right");
	});

	it("takes the least-blocked side when every side has a path", () => {
		expect(
			pickLabelSide([
				{ x: 0, y: 1 },
				{ x: 0.1, y: 1 },
				{ x: 0, y: -1 },
				{ x: 1, y: 0 },
				{ x: -1, y: 0 },
			]),
		).toBe("above");
	});

	it("ignores zero-length directions", () => {
		expect(pickLabelSide([{ x: 0, y: 0 }])).toBe("below");
	});
});

describe("labelAnchor", () => {
	const center = { x: 100, y: 50 };

	it("hangs a below label from its top edge under the sprite", () => {
		expect(labelAnchor("below", center, 40, 20, 6)).toEqual({
			x: 100,
			y: 66,
			originX: 0.5,
			originY: 0,
		});
	});

	it("stands an above label on its bottom edge over the sprite", () => {
		expect(labelAnchor("above", center, 40, 20, 6)).toEqual({
			x: 100,
			y: 34,
			originX: 0.5,
			originY: 1,
		});
	});

	it("puts side labels beside the sprite, vertically centred", () => {
		expect(labelAnchor("right", center, 40, 20, 6)).toEqual({
			x: 126,
			y: 50,
			originX: 0,
			originY: 0.5,
		});
		expect(labelAnchor("left", center, 40, 20, 6)).toEqual({
			x: 74,
			y: 50,
			originX: 1,
			originY: 0.5,
		});
	});
});
