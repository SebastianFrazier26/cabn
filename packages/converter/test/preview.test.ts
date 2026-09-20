import { describe, expect, test } from "vitest";
import { buildPreview } from "../src/preview.js";

describe("buildPreview", () => {
	test("keeps short content untruncated", () => {
		const result = buildPreview("line one\nline two\n");
		expect(result).toEqual({
			lines: ["line one", "line two"],
			truncated: false,
		});
	});

	test("skips blank lines when selecting", () => {
		const result = buildPreview("a\n\n\nb\n");
		expect(result.lines).toEqual(["a", "b"]);
		expect(result.truncated).toBe(false);
	});

	test("caps at 12 lines and flags truncation", () => {
		const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join(
			"\n",
		);
		const result = buildPreview(content);
		expect(result.lines).toHaveLength(12);
		expect(result.lines[0]).toBe("line 0");
		expect(result.truncated).toBe(true);
	});

	test("cuts a line over 120 chars and flags truncation", () => {
		const longLine = "x".repeat(200);
		const result = buildPreview(longLine);
		expect(result.lines).toEqual([longLine.slice(0, 120)]);
		expect(result.truncated).toBe(true);
	});

	test("stops once the 512-byte total is reached", () => {
		const line = "y".repeat(100); // 5 of these = 500 bytes, 6th would exceed 512
		const content = Array.from({ length: 10 }, () => line).join("\n");
		const result = buildPreview(content);
		expect(result.lines.length).toBeLessThan(10);
		expect(result.truncated).toBe(true);
	});

	test("an empty file is not truncated", () => {
		expect(buildPreview("")).toEqual({ lines: [], truncated: false });
	});
});
