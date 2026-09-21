import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { ZipSource } from "../src/sources/zip.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

async function collect(source: ZipSource) {
	const out: { path: string; bytes: number; content: Uint8Array }[] = [];
	for await (const entry of source.entries()) {
		out.push({
			path: entry.path,
			bytes: entry.bytes,
			content: await entry.read(),
		});
	}
	return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("ZipSource: zip-slip", () => {
	test("rejects path traversal, absolute paths, and backslash-style traversal", async () => {
		const bytes = await readFile(join(FIXTURES, "hostile-zip-slip.zip"));
		const entries = await collect(new ZipSource(bytes));
		const paths = entries.map((e) => e.path);

		expect(paths).not.toContain("../../outside.txt");
		expect(paths).not.toContain("/abs/path.txt");
		expect(paths.some((p) => p.includes(".."))).toBe(false);
		expect(paths.some((p) => p.startsWith("/"))).toBe(false);
		expect(paths).toContain("safe/inside.txt");
	});

	test("rejects double slashes and single-dot segments", async () => {
		const zipped = zipSync({
			"a//b.txt": utf8("double slash"),
			"./sneaky.txt": utf8("dot segment"),
			"fine.txt": utf8("ok"),
		});
		const entries = await collect(new ZipSource(zipped));
		expect(entries.map((e) => e.path)).toEqual(["fine.txt"]);
	});
});

describe("ZipSource: zip bomb", () => {
	test("caps a single high-ratio entry's retained content instead of materializing it fully", async () => {
		const bytes = await readFile(join(FIXTURES, "hostile-zip-bomb.zip"));
		const entries = await collect(new ZipSource(bytes, { maxFileBytes: 1024 }));

		const bomb = entries.find((e) => e.path === "bomb.txt");
		const normal = entries.find((e) => e.path === "normal.txt");

		expect(bomb).toBeDefined();
		expect(bomb?.content.length).toBe(0); // metadata-only: content withheld, not the 20MB payload
		expect(normal?.content).toEqual(utf8("just a normal small file\n"));
	});

	test("entry-count cap is enforced during extraction, not after", async () => {
		const zipped = zipSync(
			Object.fromEntries(
				Array.from({ length: 10 }, (_, i) => [`f${i}.txt`, utf8("x")]),
			),
		);
		const source = new ZipSource(zipped, { maxFiles: 3 });
		const entries = await collect(source);

		expect(entries).toHaveLength(3);
		expect(source.droppedEntryCount()).toBe(7);
	});

	test("archive-wide maxTotalBytes stops extracting further entries once exhausted", async () => {
		const zipped = zipSync({
			"a.txt": new Uint8Array(400).fill(65),
			"b.txt": new Uint8Array(400).fill(66),
			"c.txt": new Uint8Array(400).fill(67),
		});
		// a.txt + b.txt exactly exhaust the 800-byte total; c.txt's cap check
		// runs before any decompression starts, so it's dropped outright.
		const source = new ZipSource(zipped, {
			maxFileBytes: 10_000,
			maxTotalBytes: 800,
		});
		const entries = await collect(source);

		expect(entries.map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
		expect(entries.every((e) => e.content.length === 400)).toBe(true);
		expect(source.droppedEntryCount()).toBe(1);
	});
});
