import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const ALLOWED_NODE_IMPORTER = "sources/dir.ts";

async function listTsFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listTsFiles(full)));
		} else if (entry.name.endsWith(".ts")) {
			files.push(full);
		}
	}
	return files;
}

// The `./browser` package export omits sources/dir.ts, so every other file
// must stay free of node:* imports or that export silently breaks.
test("only sources/dir.ts imports node:* modules", async () => {
	const files = await listTsFiles(SRC_ROOT);
	const offenders: string[] = [];

	for (const file of files) {
		const rel = relative(SRC_ROOT, file);
		if (rel === ALLOWED_NODE_IMPORTER) continue;
		const content = await readFile(file, "utf8");
		if (/from\s+["']node:/.test(content)) offenders.push(rel);
	}

	expect(offenders).toEqual([]);
});

describe("browser entry point", () => {
	test("does not re-export DirSource", async () => {
		const content = await readFile(join(SRC_ROOT, "browser.ts"), "utf8");
		expect(content).not.toMatch(/from\s+["'].*sources\/dir/);
	});
});
