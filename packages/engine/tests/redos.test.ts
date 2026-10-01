import { describe, expect, test } from "vitest";
import {
	defaultFormatOptions,
	formatText,
	lineChanges,
} from "../src/systems/editorFormat.js";
import { atxHeading, outlineSymbols } from "../src/systems/editorOutline.js";
import { enchantMdLine } from "../src/systems/enchantMd.js";

// A world file can be up to 512 KB, all on one line.
const LINE = 512 * 1024;
// Each payload took seconds (or, for the heading, minutes) before its fix.
const BUDGET_MS = 750;

function expectFast<T>(fn: () => T): T {
	const start = performance.now();
	const value = fn();
	expect(performance.now() - start).toBeLessThan(BUDGET_MS);
	return value;
}

const OLD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

describe("markdown outline headings", () => {
	test("a heading with a long run of spaces stays fast", () => {
		const text = `# a${" ".repeat(LINE)}b`;
		const symbols = expectFast(() => outlineSymbols(text, "markdown"));
		expect(symbols.map((s) => s.name)).toEqual([`a${" ".repeat(LINE)}b`]);
	});

	test.each([
		"# Title",
		"## Title ##",
		"###   spaced   out   ###   ",
		"# a # b #",
		"####### seven",
		"#no-space",
		"# ##",
		"#  ",
		"# ",
		"#\t\tTabbed\t#\t",
		"# C# notes",
	])("matches the old pattern on %j", (line) => {
		const m = OLD_HEADING.exec(line);
		expect(atxHeading(line)).toEqual(
			m?.[1] && m[2] ? { level: m[1].length, name: m[2] } : null,
		);
	});

	test("matches the old pattern on random lines", () => {
		let seed = 5;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const alphabet = ["#", " ", "\t", "a", "\r", " "];
		for (let i = 0; i < 20_000; i++) {
			let line = "";
			const n = Math.floor(rand() * 12);
			for (let j = 0; j < n; j++)
				line += alphabet[Math.floor(rand() * alphabet.length)];
			const m = OLD_HEADING.exec(line);
			expect(atxHeading(line)).toEqual(
				m?.[1] && m[2] ? { level: m[1].length, name: m[2] } : null,
			);
		}
	});
});

describe("inline markdown links", () => {
	test.each([
		["`[`", "["],
		["`[a](`", "[a]("],
		["`((((`", "(((("],
		["`[a](b(`", "[a](b("],
		["`[a](b(c)`", "[a](b(c)"],
	])("%s repeated on one line stays fast", (_label, unit) => {
		expectFast(() => enchantMdLine(unit.repeat(LINE / unit.length)));
	});

	test("an ordinary link still renders", () => {
		const line = enchantMdLine("see [the docs](https://example.com/docs)");
		expect(
			line.segments.some((s) => s.href === "https://example.com/docs"),
		).toBe(true);
	});
});

describe("trailing whitespace", () => {
	const payload = `${" ".repeat(LINE)}x`;

	test("formatting a line of blanks that isn't trailing stays fast", () => {
		expect(
			expectFast(() =>
				formatText(payload, {
					...defaultFormatOptions("typescript"),
					trimTrailingWhitespace: true,
					ensureFinalNewline: false,
				}),
			),
		).toBe(payload);
	});

	test("diffing it stays fast", () => {
		const inner = `x${payload}`;
		expect(expectFast(() => lineChanges(inner, `${inner} `))).toHaveLength(1);
	});

	test("trailing blanks are still trimmed", () => {
		expect(
			formatText("a \t\nb\t \n", {
				...defaultFormatOptions("typescript"),
				trimTrailingWhitespace: true,
			}),
		).toBe("a\nb\n");
	});
});
