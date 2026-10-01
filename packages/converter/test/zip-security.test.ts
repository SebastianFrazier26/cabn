import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { ZipSource } from "../src/sources/zip.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

async function collect(source: ZipSource) {
	const out: {
		path: string;
		bytes: number;
		content: Uint8Array | undefined;
	}[] = [];
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

	// 2026-10-01: sanitizeZipPath used to normalize backslashes to "/" and
	// only block the '.'/'..' segments that fell out of that — a Windows
	// drive-relative entry ("C:foo", "C:..") or a UNC/extended-length prefix
	// (always carries a backslash) sailed through untouched. zipSync does no
	// path validation of its own, so these round-trip as real zip entries.
	test("rejects Windows drive-relative segments, UNC/extended-length prefixes, and NUL", async () => {
		const zipped = zipSync({
			"C:evil.txt": utf8("drive-relative, no separator"),
			"C:../../evil.txt": utf8("drive-relative parent"),
			"C:/Windows/System32/evil.txt": utf8("drive-absolute"),
			"nested/C:evil.txt": utf8("drive-relative segment not at the root"),
			"\\\\server\\share\\file.txt": utf8("UNC share"),
			"\\\\?\\C:\\Windows\\evil.txt": utf8("extended-length prefix"),
			"foo\u0000.txt": utf8("embedded NUL"),
			"safe/colon:ok.txt": utf8("a colon elsewhere in a segment is fine"),
			"fine.txt": utf8("ok"),
		});
		const entries = await collect(new ZipSource(zipped));
		expect(entries.map((e) => e.path).sort()).toEqual(
			["fine.txt", "safe/colon:ok.txt"].sort(),
		);
	});
});

describe("ZipSource: zip bomb", () => {
	test("caps a single high-ratio entry's retained content instead of materializing it fully", async () => {
		const bytes = await readFile(join(FIXTURES, "hostile-zip-bomb.zip"));
		const entries = await collect(new ZipSource(bytes, { maxFileBytes: 1024 }));

		const bomb = entries.find((e) => e.path === "bomb.txt");
		const normal = entries.find((e) => e.path === "normal.txt");

		expect(bomb).toBeDefined();
		expect(bomb?.content).toBeUndefined(); // metadata-only: content withheld, not the 20MB payload
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
		expect(entries.every((e) => e.content?.length === 400)).toBe(true);
		expect(source.droppedEntryCount()).toBe(1);
	});

	// 2026-10-01: an entry that tripped only the archive-wide total (not its
	// own maxFileBytes) used to settle with content: undefined internally but
	// surface through ZipSource.entries().read() as an empty Uint8Array —
	// indistinguishable from a real zero-byte file once walk() read it.
	test("an entry capped by the archive-wide total mid-extraction is metadata-only, not an empty file, and reports its real size", async () => {
		const zipped = zipSync({
			"a.txt": new Uint8Array(700).fill(65),
			"b.txt": new Uint8Array(100).fill(66),
		});
		// a.txt retains fully (700 of 750 spent); b.txt is well under
		// maxFileBytes on its own, but 700 + 100 > 750 trips mid-stream.
		const source = new ZipSource(zipped, {
			maxFileBytes: 10_000,
			maxTotalBytes: 750,
		});
		const entries = await collect(source);

		const a = entries.find((e) => e.path === "a.txt");
		const b = entries.find((e) => e.path === "b.txt");
		expect(a?.content).toEqual(new Uint8Array(700).fill(65));
		expect(b).toBeDefined();
		expect(b?.content).toBeUndefined();
		expect(b?.bytes).toBe(100); // the real size, not a value frozen at a partial chunk
		expect(source.droppedEntryCount()).toBe(0); // listed, not dropped outright
	});
});
