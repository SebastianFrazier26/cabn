import { describe, expect, test } from "vitest";
import type { FileSource, SourceEntry } from "../src/sources/types.js";
import { isHiddenPath, isSecretPath, walk } from "../src/walk.js";

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
	// 2026-09-28: dotfiles moved out of normal worlds into the owner-only shadow realm.
	test("drops default-ignored directories and every hidden path by default", async () => {
		const source = fakeSource({
			"src/app.ts": utf8("code"),
			"node_modules/pkg/index.js": utf8("skip me"),
			".git/config": utf8("skip me"),
			".env": utf8("HIDDEN=1"),
			".github/ci.yml": utf8("hidden"),
			"src/.eslintrc.json": utf8("{}"),
		});
		const result = await walk(source);
		expect(result.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		const explicit = await walk(source, { hidden: "exclude" });
		expect(explicit.files.map((f) => f.path)).toEqual(["src/app.ts"]);
	});

	test('hidden: "only" keeps just hidden paths, still minus ignored ones', async () => {
		const source = fakeSource({
			"src/app.ts": utf8("code"),
			".git/config": utf8("skip me"),
			".GIT/config": utf8("case-variant: not a DEFAULT_IGNORES match"),
			".venv/lib/x.py": utf8("skip me"),
			".next/cache": utf8("skip me"),
			"node_modules/.bin/x": utf8("skip me"),
			".env": utf8("HIDDEN=1"),
			".github/workflows/ci.yml": utf8("hidden"),
			"src/.eslintrc.json": utf8("{}"),
		});
		const result = await walk(source, { hidden: "only" });
		expect(result.files.map((f) => f.path)).toEqual([
			".GIT/config",
			".env",
			".github/workflows/ci.yml",
			"src/.eslintrc.json",
		]);
		// Secret-named: content-less unless includeSecrets, same as visible files.
		expect(
			result.files.find((f) => f.path === ".env")?.content,
		).toBeUndefined();
		const withSecrets = await walk(source, {
			hidden: "only",
			includeSecrets: true,
		});
		expect(withSecrets.files.find((f) => f.path === ".env")?.content).toEqual(
			utf8("HIDDEN=1"),
		);
	});

	test("isHiddenPath: any segment starting with a dot", () => {
		expect(isHiddenPath(".env")).toBe(true);
		expect(isHiddenPath(".github/ci.yml")).toBe(true);
		expect(isHiddenPath("src/.eslintrc.json")).toBe(true);
		expect(isHiddenPath("a/.b/c.txt")).toBe(true);
		expect(isHiddenPath("src/app.ts")).toBe(false);
		expect(isHiddenPath("file.with.dots")).toBe(false);
		expect(isHiddenPath("dir.d/x")).toBe(false);
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

	test("? in an ignore glob matches exactly one character, not a literal ?", async () => {
		const source = fakeSource({
			"log1.txt": utf8("drop"),
			"log12.txt": utf8("keep"),
		});
		const result = await walk(source, { ignore: ["log?.txt"] });
		expect(result.files.map((f) => f.path)).toEqual(["log12.txt"]);
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

	test("secret-pattern files are listed but content-less by default", async () => {
		const source = fakeSource({
			".env": utf8("SECRET=1"),
			".env.production": utf8("SECRET=2"),
			id_rsa: utf8("-----BEGIN PRIVATE KEY-----"),
			"deploy.pem": utf8("cert"),
			"aws-credentials.json": utf8("{}"),
			".npmrc": utf8("//registry"),
			"README.md": utf8("keep me"),
		});
		const result = await walk(source);
		const hidden = await walk(source, { hidden: "only" });
		const byPath = new Map(
			[...result.files, ...hidden.files].map((f) => [f.path, f]),
		);

		for (const secretPath of [
			".env",
			".env.production",
			"id_rsa",
			"deploy.pem",
			"aws-credentials.json",
			".npmrc",
		]) {
			const file = byPath.get(secretPath);
			expect(file, `expected ${secretPath} to still be listed`).toBeDefined();
			expect(
				file?.content,
				`expected ${secretPath} to be content-less`,
			).toBeUndefined();
		}
		expect(byPath.get("README.md")?.content).toEqual(utf8("keep me"));
	});

	// 2026-10-01: widened for git history, where hidden files do ship.
	test.each([
		".pypirc",
		".yarnrc.yml",
		".envrc",
		".terraformrc",
		".docker/config.json",
		".kube/config",
		"home/.docker/config.json",
		"ops/.kube/config",
	])("%s is secret-named", (path) => {
		expect(isSecretPath(path)).toBe(true);
		expect(isSecretPath(path, true)).toBe(false);
	});

	test.each([
		"config.json",
		"docker/config.json",
		".docker/config.json.bak",
		"kube/config",
		".kube/config/notes.md",
		".yarnrc",
	])("%s is not secret-named", (path) => {
		expect(isSecretPath(path)).toBe(false);
	});

	test("includeSecrets: true restores normal content reads for secret-pattern files", async () => {
		const source = fakeSource({ "aws-credentials.txt": utf8("SECRET=1") });
		const result = await walk(source, { includeSecrets: true });
		expect(result.files[0]?.content).toEqual(utf8("SECRET=1"));
	});

	// 2026-10-01: a source whose own total-bytes budget (ZipSource's archive-wide
	// cap today; any future directory-side budget tomorrow) withholds one
	// entry's content must signal that with undefined, not an empty buffer —
	// walk() trusts read() over bytes, so this is the generic contract every
	// FileSource (dir or zip) relies on, not a zip-specific fix.
	test("an entry under maxFileBytes whose source withheld content stays metadata-only, not an empty file", async () => {
		const source: FileSource = {
			async *entries(): AsyncIterable<SourceEntry> {
				yield {
					path: "small.txt",
					bytes: 5,
					// Simulates a source-level total-bytes cap tripping mid-entry:
					// the entry is well under maxFileBytes, but its content was
					// never retained.
					read: () => Promise.resolve(undefined),
				};
			},
		};
		const result = await walk(source, { maxFileBytes: 1000 });
		expect(result.files).toHaveLength(1);
		expect(result.files[0]?.bytes).toBe(5);
		expect(result.files[0]?.content).toBeUndefined();
	});

	test("uses a source's droppedEntryCount to report truncation", async () => {
		const source: FileSource = {
			async *entries(): AsyncIterable<SourceEntry> {
				yield {
					path: "a.txt",
					bytes: 1,
					read: () => Promise.resolve(utf8("a")),
				};
			},
			droppedEntryCount: () => 3,
		};
		const result = await walk(source);
		expect(result.truncated).toBe(true);
		expect(result.skippedFiles).toBe(3);
	});
});
