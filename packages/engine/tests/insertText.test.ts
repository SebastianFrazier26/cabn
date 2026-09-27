import { describe, expect, it } from "vitest";
import { insertTextAt } from "../src/systems/insertText.js";

describe("insertTextAt", () => {
	it("inserts in the middle of a document, caret after the inserted text", () => {
		const result = insertTextAt("const x = ;", 10, "42");
		expect(result).toEqual({ text: "const x = 42;", cursor: 12 });
	});

	it("inserts at the very start", () => {
		expect(insertTextAt("world", 0, "hello ")).toEqual({
			text: "hello world",
			cursor: 6,
		});
	});

	it("inserts at the very end", () => {
		expect(insertTextAt("hello", 5, " world")).toEqual({
			text: "hello world",
			cursor: 11,
		});
	});

	it("inserts multi-line text", () => {
		const result = insertTextAt("ab", 1, "\nX\n");
		expect(result).toEqual({ text: "a\nX\nb", cursor: 4 });
	});

	it("inserting an empty string is a no-op on content, caret unchanged", () => {
		expect(insertTextAt("hello", 3, "")).toEqual({ text: "hello", cursor: 3 });
	});

	it("clamps a negative cursor to the start", () => {
		expect(insertTextAt("hello", -5, "X")).toEqual({
			text: "Xhello",
			cursor: 1,
		});
	});

	it("clamps a cursor past the end to the document length", () => {
		expect(insertTextAt("hello", 999, "X")).toEqual({
			text: "helloX",
			cursor: 6,
		});
	});

	it("inserting into an empty document", () => {
		expect(insertTextAt("", 0, "hi")).toEqual({ text: "hi", cursor: 2 });
	});
});
