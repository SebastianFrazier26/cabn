#!/usr/bin/env node
// `pnpm check:packs`, after `pnpm -r build`: asks pnpm what each publishable
// package's tarball would hold (`pnpm pack --dry-run --json`, the same file
// list `pnpm publish` uses) and fails on anything that shouldn't ship:
// source maps (they point at ../src, which isn't published), src/ or tests/,
// and shadow art inside @cabn/cli (it ships as @cabn/shadow-art).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");

function packProblems(name, files) {
	const problems = [];
	for (const path of files) {
		if (path.endsWith(".map")) problems.push(`${path}: source map`);
		if (/^(src|tests?)\//.test(path)) problems.push(`${path}: source/tests`);
		if (name === "@cabn/cli" && /(^|\/)shadow\//i.test(path))
			problems.push(`${path}: shadow art belongs in @cabn/shadow-art`);
	}
	return problems;
}

function main() {
	let failed = false;
	let checked = 0;
	for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dir = join(packagesDir, entry.name);
		const manifest = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		);
		if (manifest.private) continue;
		const out = execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
			cwd: dir,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		const files = JSON.parse(out).files.map((f) => f.path);
		const problems = packProblems(manifest.name, files);
		checked++;
		if (problems.length === 0) {
			console.log(`check-packs: ${manifest.name} OK (${files.length} files)`);
			continue;
		}
		failed = true;
		console.error(`check-packs: ${manifest.name} FAILED:`);
		for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
		if (problems.length > 20)
			console.error(`  ...and ${problems.length - 20} more`);
	}
	if (checked === 0) {
		console.error("check-packs: no publishable packages found");
		failed = true;
	}
	if (failed) process.exit(1);
}

main();
