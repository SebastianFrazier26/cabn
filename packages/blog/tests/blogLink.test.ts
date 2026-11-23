import { describe, expect, it } from "vitest";
import { type ClickLike, isPlainLeftClick } from "../src/BlogLink.js";

const plain: ClickLike = {
	defaultPrevented: false,
	button: 0,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
};

describe("isPlainLeftClick", () => {
	it("accepts an unmodified left click", () => {
		expect(isPlainLeftClick(plain)).toBe(true);
	});

	it.each([
		{ button: 1 },
		{ metaKey: true },
		{ ctrlKey: true },
		{ shiftKey: true },
		{ altKey: true },
		{ defaultPrevented: true },
	])("leaves %j to the browser", (change) => {
		expect(isPlainLeftClick({ ...plain, ...change })).toBe(false);
	});
});
