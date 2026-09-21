import { describe, expect, it } from "vitest";
import { clampPreviewLines } from "../src/systems/previewText.js";

describe("clampPreviewLines", () => {
	it("passes lines through unchanged when they fit", () => {
		const result = clampPreviewLines(["short", "also short"], 20, 6);
		expect(result.lines).toEqual(["short", "also short"]);
		expect(result.truncated).toBe(false);
	});

	it("truncates a line longer than maxLineChars with an ellipsis", () => {
		const result = clampPreviewLines(["a very long line of code here"], 10, 6);
		expect(result.lines[0]).toHaveLength(10);
		expect(result.lines[0]?.endsWith("…")).toBe(true);
		expect(result.truncated).toBe(true);
	});

	it("drops lines beyond maxLines and flags truncated", () => {
		const result = clampPreviewLines(["1", "2", "3", "4"], 20, 2);
		expect(result.lines).toEqual(["1", "2"]);
		expect(result.truncated).toBe(true);
	});

	it("is not truncated when both caps are respected exactly", () => {
		const result = clampPreviewLines(["1234567890"], 10, 1);
		expect(result.truncated).toBe(false);
	});

	it("handles an empty preview", () => {
		const result = clampPreviewLines([], 20, 6);
		expect(result.lines).toEqual([]);
		expect(result.truncated).toBe(false);
	});
});
