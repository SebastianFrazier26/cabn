import { describe, expect, test } from "vitest";
import type { FileSource, SourceEntry } from "../src/sources/types.js";
import { walk } from "../src/walk.js";

function fakeSource(files: Record<string, Uint8Array>): FileSource {
	return {
		async *entries(): AsyncIterable<SourceEntry> {
			for (const [path, bytes] of Object.entries(files)) {
				yield { path, bytes: bytes.length, read: () => Promise.resolve(bytes) };
			}
		},
	};
}

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("walk", () => {
	test("drops default-ignored directories but keeps other dotfiles", async () => {
		const source = fakeSource({
			"src/app.ts": utf8("code"),
			"node_modules/pkg/index.js": utf8("skip me"),
			".git/config": utf8("skip me"),
			".env": utf8("KEEP=1"),
		});
		const result = await walk(source);
		const paths = result.files.map((f) => f.path).sort();
		expect(paths).toEqual([".env", "src/app.ts"]);
	});

	test("merges user-supplied ignore patterns, including globs", async () => {
		const source = fakeSource({
			"app.ts": utf8("keep"),
			"debug.log": utf8("drop"),
			"nested/debug.log": utf8("drop"),
		});
		const result = await walk(source, { ignore: ["*.log"] });
		expect(result.files.map((f) => f.path)).toEqual(["app.ts"]);
	});

	test("caps total files and reports truncation", async () => {
		const files: Record<string, Uint8Array> = {};
		for (let i = 0; i < 10; i++) files[`f${i}.txt`] = utf8("x");
		const result = await walk(fakeSource(files), { maxFiles: 5 });
		expect(result.files).toHaveLength(5);
		expect(result.truncated).toBe(true);
		// Deterministic: lexicographically first 5 paths, not enumeration order.
		expect(result.files.map((f) => f.path)).toEqual([
			"f0.txt",
			"f1.txt",
			"f2.txt",
			"f3.txt",
			"f4.txt",
		]);
	});

	test("files over maxFileBytes become metadata-only (no content read)", async () => {
		const small = utf8("ok");
		const big = new Uint8Array(20);
		const result = await walk(
			fakeSource({ "small.txt": small, "big.txt": big }),
			{ maxFileBytes: 10 },
		);
		const smallFile = result.files.find((f) => f.path === "small.txt");
		const bigFile = result.files.find((f) => f.path === "big.txt");
		expect(smallFile?.content).toEqual(small);
		expect(bigFile?.content).toBeUndefined();
		expect(bigFile?.bytes).toBe(20);
	});

	test("totalBytes counts every accepted file regardless of content cap", async () => {
		const result = await walk(
			fakeSource({ a: new Uint8Array(3), b: new Uint8Array(7) }),
			{ maxFileBytes: 5 },
		);
		expect(result.totalBytes).toBe(10);
	});
});
