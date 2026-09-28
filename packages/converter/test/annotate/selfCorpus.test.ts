import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { deadCode } from "../../src/annotate/deadCode.js";
import { syntaxError } from "../../src/annotate/syntaxError.js";
import { fileFor } from "./helpers.js";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const ROOTS = ["packages", "apps", "tools"];
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"public",
	"fixtures",
	"sample-project",
	"notes-vault",
	"generated",
	"test-results",
	"playwright-report",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) sourceFiles(path, out);
		else if (/\.(ts|tsx|js|mjs|py|css|html)$/.test(name)) out.push(path);
	}
	return out;
}

// A real, type-checked, lint-clean corpus (this repo) must produce no imps
// and no skeletons. A failure here usually means code started using a
// construct the Lezer grammar can't parse: add it to syntaxTree.ts's
// GAP_LINE_PATTERNS/GAP_ANCESTORS rather than accepting the false positive.
test("this repo's own source spawns no imps or skeletons", () => {
	const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)));
	expect(files.length).toBeGreaterThan(200);
	const hits: string[] = [];
	for (const path of files) {
		const rel = relative(REPO, path);
		const content = readFileSync(path, "utf8");
		const ctx = { file: fileFor(rel), content, worldFiles: new Set([rel]) };
		for (const a of [...syntaxError(ctx), ...deadCode(ctx)]) {
			hits.push(`${rel}:${(a.loc?.line ?? 0) + 1} ${a.code} ${a.message}`);
		}
	}
	expect(hits).toEqual([]);
});
