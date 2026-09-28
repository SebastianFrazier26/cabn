import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { convert } from "../../src/convert.js";
import {
	diffLines,
	diffText,
	reverseApplyHunks,
	splitLines,
	toHunks,
} from "../../src/history/diff.js";
import { parseGithubRemote } from "../../src/history/githubReleases.js";
import { ZipSource } from "../../src/sources/zip.js";
import { walk } from "../../src/walk.js";

function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("line diff", () => {
	test("hunks carry 1-based starts and three lines of context", () => {
		const oldText = `${Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join("\n")}\n`;
		const newText = oldText.replace("l6\n", "L6\n");
		const diff = diffText(oldText, newText);
		expect(diff?.additions).toBe(1);
		expect(diff?.deletions).toBe(1);
		expect(diff?.hunks).toEqual([
			{
				oldStart: 3,
				oldLines: 7,
				newStart: 3,
				newLines: 7,
				lines: [" l3", " l4", " l5", "-l6", "+L6", " l7", " l8", " l9"],
			},
		]);
	});

	test("far-apart changes split into separate hunks; near ones merge", () => {
		const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
		const far = [...lines];
		far[2] = "x";
		far[25] = "y";
		expect(toHunks(diffLines(lines, far) ?? [])).toHaveLength(2);
		const near = [...lines];
		near[2] = "x";
		near[7] = "y";
		expect(toHunks(diffLines(lines, near) ?? [])).toHaveLength(1);
	});

	test("added and deleted files", () => {
		expect(diffText("", "a\nb\n")?.hunks).toEqual([
			{
				oldStart: 0,
				oldLines: 0,
				newStart: 1,
				newLines: 2,
				lines: ["+a", "+b"],
			},
		]);
		expect(
			reverseApplyHunks("a\nb\n", diffText("", "a\nb\n")?.hunks ?? []),
		).toBe("");
		expect(reverseApplyHunks("", diffText("a\n", "")?.hunks ?? [])).toBe("a\n");
	});

	test("random edits always round-trip through reverseApplyHunks", () => {
		const rand = mulberry32(42);
		for (let round = 0; round < 200; round++) {
			const base = Array.from(
				{ length: Math.floor(rand() * 40) },
				() => `w${Math.floor(rand() * 8)}`,
			);
			const edited = [...base];
			for (let e = 0; e < 5; e++) {
				const at = Math.floor(rand() * (edited.length + 1));
				const op = rand();
				if (op < 0.33) edited.splice(at, 1);
				else if (op < 0.66) edited.splice(at, 0, `n${Math.floor(rand() * 8)}`);
				else if (at < edited.length) edited[at] = `m${Math.floor(rand() * 8)}`;
			}
			const oldText = base.length ? `${base.join("\n")}\n` : "";
			const newText = edited.length ? `${edited.join("\n")}\n` : "";
			const diff = diffText(oldText, newText);
			expect(diff).not.toBeNull();
			expect(reverseApplyHunks(newText, diff?.hunks ?? [])).toBe(oldText);
		}
	});

	test("reverseApplyHunks refuses hunks that don't match the text", () => {
		const diff = diffText("a\nb\n", "a\nc\n");
		expect(reverseApplyHunks("a\nzzz\n", diff?.hunks ?? [])).toBeNull();
	});

	test("an enormous rewrite gives up instead of burning memory", () => {
		const a = Array.from({ length: 2000 }, (_, i) => `a${i}`);
		const b = Array.from({ length: 2000 }, (_, i) => `b${i}`);
		expect(diffLines(a, b)).toBeNull();
	});

	test("splitLines treats a trailing newline as a terminator", () => {
		expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
		expect(splitLines("a\nb")).toEqual(["a", "b"]);
		expect(splitLines("")).toEqual([]);
	});
});

describe("parseGithubRemote", () => {
	test.each([
		["https://github.com/wren/garden.git", { owner: "wren", name: "garden" }],
		["https://github.com/wren/garden", { owner: "wren", name: "garden" }],
		["git@github.com:wren/garden.git", { owner: "wren", name: "garden" }],
		["ssh://git@github.com/wren/garden.git", { owner: "wren", name: "garden" }],
	])("%s", (url, expected) => {
		expect(parseGithubRemote(url)).toEqual(expected);
	});

	test.each([
		"https://gitlab.com/wren/garden.git",
		"https://github.com.evil.example/wren/garden",
		"https://evil.example/github.com/wren/garden",
		"https://github.com/wren",
		"https://github.com/wren/garden/extra",
		"https://github.com/wr%20en/garden",
		"file:///srv/github.com/wren/garden",
	])("rejects %s", (url) => {
		expect(parseGithubRemote(url)).toBeNull();
	});
});

describe("uploads never carry a repository", () => {
	test("ZipSource skips .git entries before they count against the caps", async () => {
		const zip = zipSync({
			".git/HEAD": strToU8("ref: refs/heads/main\n"),
			".git/objects/ab/cdef": strToU8("x".repeat(100)),
			"sub/.git/config": strToU8("[core]\n"),
			"README.md": strToU8("# hi\n"),
		});
		const source = new ZipSource(zip, { maxFiles: 1 });
		const result = await walk(source);
		expect(result.files.map((f) => f.path)).toEqual(["README.md"]);
		expect(result.truncated).toBe(false);
	});

	test("convert() of a zip writes no history even when the zip holds a .git", async () => {
		const zip = zipSync({
			".git/HEAD": strToU8("ref: refs/heads/main\n"),
			"README.md": strToU8("# hi\n"),
		});
		const bundle = await convert(new ZipSource(zip), {
			name: "z",
			source: "z",
		});
		expect(bundle.has("history.json")).toBe(false);
	});
});

describe("walk sealedPaths", () => {
	test("listed but unread, regardless of includeSecrets", async () => {
		const zip = zipSync({
			"a.txt": strToU8("secret-ish"),
			"b.txt": strToU8("fine"),
		});
		const result = await walk(new ZipSource(zip), {
			sealedPaths: new Set(["a.txt"]),
			includeSecrets: true,
		});
		expect(
			result.files.find((f) => f.path === "a.txt")?.content,
		).toBeUndefined();
		expect(result.files.find((f) => f.path === "b.txt")?.content).toBeDefined();
	});
});
