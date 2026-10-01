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
const BUDGET_MS = 3000;
// A fixed budget alone flakes when `pnpm -r test` loads the machine, so each
// payload must also scale like linear code: every 4x step up in size in under
// 8x the time (quadratic takes ~16x). Climbing from size / 64 makes a
// quadratic regression fail on a small rung in about a second instead of
// hanging on the full size, and the floor keeps sub-millisecond timer noise
// from failing a ratio.
const MAX_RATIO = 8;
const FLOOR_MS = 10;

function timed<T>(fn: () => T): { value: T; ms: number } {
	const start = performance.now();
	const value = fn();
	return { value, ms: performance.now() - start };
}

/** `run(build(size))`, after checking it scales linearly up to `size`; a rung that misses gets two more tries. */
function expectLinear<I, T>(
	build: (size: number) => I,
	run: (input: I) => T,
	size = LINE,
): T {
	let prevMs = 0;
	let value: T | undefined;
	for (const n of [size / 64, size / 16, size / 4, size].map(Math.floor)) {
		const input = build(n);
		const limit = MAX_RATIO * Math.max(prevMs, FLOOR_MS);
		let ms = Number.POSITIVE_INFINITY;
		for (let attempt = 0; attempt < 3 && ms >= limit; attempt++) {
			const result = timed(() => run(input));
			value = result.value;
			ms = Math.min(ms, result.ms);
		}
		expect(ms, `size ${n}`).toBeLessThan(limit);
		prevMs = ms;
	}
	expect(prevMs).toBeLessThan(BUDGET_MS);
	return value as T;
}

const OLD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

describe("markdown outline headings", () => {
	test("a heading with a long run of spaces stays fast", () => {
		const symbols = expectLinear(
			(n) => `# a${" ".repeat(n)}b`,
			(text) => outlineSymbols(text, "markdown"),
		);
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
		expectLinear(
			(n) => unit.repeat(Math.floor(n / unit.length)),
			enchantMdLine,
		);
	});

	test("an ordinary link still renders", () => {
		const line = enchantMdLine("see [the docs](https://example.com/docs)");
		expect(
			line.segments.some((s) => s.href === "https://example.com/docs"),
		).toBe(true);
	});
});

describe("trailing whitespace", () => {
	const blanks = (n: number) => `${" ".repeat(n)}x`;

	test("formatting a line of blanks that isn't trailing stays fast", () => {
		expect(
			expectLinear(blanks, (payload) =>
				formatText(payload, {
					...defaultFormatOptions("typescript"),
					trimTrailingWhitespace: true,
					ensureFinalNewline: false,
				}),
			),
		).toBe(blanks(LINE));
	});

	test("diffing it stays fast", () => {
		expect(
			expectLinear(
				(n) => `x${blanks(n)}`,
				(inner) => lineChanges(inner, `${inner} `),
			),
		).toHaveLength(1);
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
