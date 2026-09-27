import type { PortalFile } from "@cabn/world-schema";
import { describe, expect, test } from "vitest";
import { brokenImport } from "../../src/annotate/brokenImport.js";
import { classify } from "../../src/classify.js";

function file(path: string): PortalFile {
	const info = classify(path);
	return {
		path,
		name: path.split("/").pop() ?? path,
		kind: info.kind,
		language: info.language,
		bytes: 0,
		binary: false,
	};
}

function run(path: string, content: string, worldFiles: string[]) {
	return brokenImport({
		file: file(path),
		content,
		worldFiles: new Set(worldFiles),
	});
}

describe("brokenImport", () => {
	test("flags a relative TS import to a missing file", () => {
		const results = run("src/a.ts", `import { x } from "./missing.js";\n`, [
			"src/a.ts",
		]);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "NullTypeError",
			species: "ghost",
			loc: { line: 0 },
		});
	});

	test("does not flag a relative TS import resolving via the .js -> .ts convention", () => {
		const results = run("src/a.ts", `import { b } from "./b.js";\n`, [
			"src/a.ts",
			"src/b.ts",
		]);
		expect(results).toHaveLength(0);
	});

	test("resolves an extensionless import against an index file", () => {
		const results = run("src/a.ts", `import { x } from "./utils";\n`, [
			"src/a.ts",
			"src/utils/index.ts",
		]);
		expect(results).toHaveLength(0);
	});

	test("does not flag a bare (non-relative) package import", () => {
		const results = run("src/a.ts", `import express from "express";\n`, [
			"src/a.ts",
		]);
		expect(results).toHaveLength(0);
	});

	test("flags a Python relative import that doesn't resolve", () => {
		const results = run("pkg/mod.py", "from .missing import thing\n", [
			"pkg/mod.py",
			"pkg/__init__.py",
		]);
		expect(results).toHaveLength(1);
		expect(results[0]?.species).toBe("ghost");
	});

	test("resolves a Python relative import to a sibling module", () => {
		const results = run("pkg/mod.py", "from .sibling import thing\n", [
			"pkg/mod.py",
			"pkg/sibling.py",
		]);
		expect(results).toHaveLength(0);
	});

	test("resolves a two-dot Python relative import to the parent package", () => {
		const results = run("pkg/sub/mod.py", "from ..top import thing\n", [
			"pkg/sub/mod.py",
			"pkg/top.py",
		]);
		expect(results).toHaveLength(0);
	});

	test("flags a dead markdown relative link", () => {
		const results = run(
			"notes/index.md",
			"See [my note](./missing-note.md) for details.\n",
			["notes/index.md"],
		);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "NullTypeError",
			species: "ghost",
		});
	});

	test("does not flag a markdown link to an existing file", () => {
		const results = run(
			"notes/index.md",
			"See [my note](./other.md) for details.\n",
			["notes/index.md", "notes/other.md"],
		);
		expect(results).toHaveLength(0);
	});

	test("flags a dead Obsidian-style wikilink", () => {
		const results = run(
			"notes/index.md",
			"See [[missing-note]] for details.\n",
			["notes/index.md"],
		);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			code: "NullTypeError",
			species: "ghost",
		});
	});

	test("resolves a wikilink relative to the world root, not the linking file's own directory", () => {
		// A file under notes/daily/ linking [[projects/x]] means the vault-root
		// projects/x.md, the same way Obsidian resolves it — not
		// notes/daily/projects/x.md. This is the real notes-vault demo fixture's
		// own link style (see the M6 CHANGELOG).
		const results = run(
			"notes/daily/2026-09-19.md",
			"See [[projects/cabn-notes]] and [[recipes/soup|dinner]].\n",
			[
				"notes/daily/2026-09-19.md",
				"projects/cabn-notes.md",
				"recipes/soup.md",
			],
		);
		expect(results).toHaveLength(0);
	});

	test("ignores absolute-URL and anchor-only markdown links", () => {
		const results = run(
			"notes/index.md",
			"[external](https://example.com) and [anchor](#top)\n",
			["notes/index.md"],
		);
		expect(results).toHaveLength(0);
	});

	test("returns nothing for a file with no content (binary/oversized)", () => {
		const results = brokenImport({
			file: file("src/a.ts"),
			content: undefined,
			worldFiles: new Set(["src/a.ts"]),
		});
		expect(results).toHaveLength(0);
	});
});
