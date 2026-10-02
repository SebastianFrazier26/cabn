import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DirSource } from "../../src/sources/dir.js";
import {
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_MAX_FILES,
	walk,
} from "../../src/walk.js";

// Real-filesystem coverage for DirSource: everything in walk.test.ts drives
// walk() against an in-memory FileSource, so DirSource's own fs.readdir/stat
// walk (deep nesting, symlinks, real file counts) had no coverage at all.

let tmp: string | undefined;

async function makeTmpDir(): Promise<string> {
	tmp = await mkdtemp(join(tmpdir(), "cabn-dir-source-"));
	return tmp;
}

afterEach(async () => {
	if (tmp) await rm(tmp, { recursive: true, force: true });
	tmp = undefined;
});

async function collect(root: string) {
	const out: { path: string; bytes: number; content: Uint8Array }[] = [];
	for await (const entry of new DirSource(root).entries()) {
		out.push({
			path: entry.path,
			bytes: entry.bytes,
			content: await entry.read(),
		});
	}
	return out;
}

describe("DirSource: real filesystem", () => {
	test("an empty directory yields zero entries", async () => {
		const root = await makeTmpDir();
		expect(await collect(root)).toEqual([]);
	});

	test("50 levels of nesting produces a posix-separated path, not a crash", async () => {
		const root = await makeTmpDir();
		let dir = root;
		for (let i = 0; i < 50; i++) {
			dir = join(dir, `d${i}`);
		}
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "leaf.txt"), "deep");

		const entries = await collect(root);
		expect(entries).toHaveLength(1);
		const expectedPath = `${Array.from({ length: 50 }, (_, i) => `d${i}`).join("/")}/leaf.txt`;
		expect(entries[0]?.path).toBe(expectedPath);
		expect(new TextDecoder().decode(entries[0]?.content)).toBe("deep");
	});

	test("unicode and emoji filenames round-trip through path and content", async () => {
		const root = await makeTmpDir();
		const names = ["café.txt", "文件.md", "😀-emoji.txt", "naïve-résumé.js"];
		for (const name of names) {
			await writeFile(join(root, name), `content for ${name}`);
		}
		const entries = await collect(root);
		const paths = entries.map((e) => e.path).sort();
		expect(paths).toEqual([...names].sort());
		for (const name of names) {
			const entry = entries.find((e) => e.path === name);
			expect(new TextDecoder().decode(entry?.content)).toBe(
				`content for ${name}`,
			);
		}
	});

	test("a directory symlink loop is skipped, not followed", async () => {
		const root = await makeTmpDir();
		await mkdir(join(root, "a"));
		await writeFile(join(root, "a", "real.txt"), "kept");
		// a/loop -> a itself: if walkDir ever followed directory symlinks this
		// would recurse forever instead of terminating.
		await symlink(join(root, "a"), join(root, "a", "loop"), "dir");

		const entries = await Promise.race([
			collect(root),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("walk did not terminate")), 5000),
			),
		]);
		expect(entries.map((e) => e.path)).toEqual(["a/real.txt"]);
	});

	test("a file symlink is skipped rather than read through", async () => {
		const root = await makeTmpDir();
		await writeFile(join(root, "real.txt"), "kept");
		await symlink(join(root, "real.txt"), join(root, "link.txt"), "file");

		const entries = await collect(root);
		expect(entries.map((e) => e.path)).toEqual(["real.txt"]);
	});

	test("a binary-only directory is walked without decoding errors", async () => {
		const root = await makeTmpDir();
		const binary = new Uint8Array([0, 1, 2, 255, 254, 0, 128, 37]);
		await writeFile(join(root, "blob.bin"), binary);
		await mkdir(join(root, "nested"));
		await writeFile(join(root, "nested", "also.bin"), binary.slice(0, 4));

		const entries = await collect(root);
		const top = entries.find((e) => e.path === "blob.bin");
		// DirSource.read() resolves node:fs's Buffer (a Uint8Array subclass);
		// compare byte values, not constructor identity, which toEqual checks.
		expect(Array.from(top?.content ?? [])).toEqual(Array.from(binary));
	});

	test("a single file far over maxFileBytes is capped by walk(), not by DirSource", async () => {
		const root = await makeTmpDir();
		const big = new Uint8Array(DEFAULT_MAX_FILE_BYTES + 1024).fill(65);
		await writeFile(join(root, "huge.bin"), big);
		await writeFile(join(root, "small.txt"), "ok");

		const result = await walk(new DirSource(root));
		const huge = result.files.find((f) => f.path === "huge.bin");
		const small = result.files.find((f) => f.path === "small.txt");
		expect(huge?.bytes).toBe(big.length);
		expect(huge?.content).toBeUndefined(); // metadata-only past the cap
		expect(Array.from(small?.content ?? [])).toEqual(
			Array.from(new TextEncoder().encode("ok")),
		);
	});

	test("5000 tiny files: DirSource yields all of them, walk() truncates to DEFAULT_MAX_FILES", async () => {
		const root = await makeTmpDir();
		const count = 5000;
		const writes: Promise<void>[] = [];
		for (let i = 0; i < count; i++) {
			writes.push(
				writeFile(join(root, `f${String(i).padStart(5, "0")}.txt`), "x"),
			);
		}
		await Promise.all(writes);

		const raw = await collect(root);
		expect(raw).toHaveLength(count);

		const result = await walk(new DirSource(root));
		expect(result.files).toHaveLength(DEFAULT_MAX_FILES);
		expect(result.truncated).toBe(true);
		expect(result.skippedFiles).toBe(count - DEFAULT_MAX_FILES);
	}, 30_000);
});
