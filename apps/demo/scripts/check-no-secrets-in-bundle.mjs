#!/usr/bin/env node
// Postbuild check (see package.json), alongside check-no-exec-in-bundle.mjs:
// the AI pets are bring-your-own-key, so a provider key must never ship in
// the bundle — not a real one pasted into source during development, and not
// a sample one either (a key-shaped literal in a public bundle gets scraped
// and reported as leaked). Scans every emitted text asset except dist/worlds:
// world bundles are the sample projects' own data, and the sample project
// plants a fake key on purpose for its magpie (leaked-secret) monster.
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");
const worldsDir = join(distDir, "worlds");

const TEXT_EXTENSIONS = new Set([
	".js",
	".mjs",
	".css",
	".html",
	".json",
	".map",
	".txt",
	".md",
	".svg",
]);

// Key shapes of the pet providers (and the most common other ones). The
// lookbehind keeps "sk-" inside words (task-, mask-, disk-) from matching.
const KEY_PATTERNS = [
	{
		name: "sk- style key (OpenAI/Anthropic/DeepSeek/DashScope)",
		re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/,
	},
	{ name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
	{ name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
	{ name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
	{ name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

async function listFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (full !== worldsDir) files.push(...(await listFiles(full)));
		} else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(full);
	}
	return files;
}

async function main() {
	const files = await listFiles(distDir);
	if (!files.some((f) => f.endsWith(".js"))) {
		console.error(
			`check-no-secrets-in-bundle: no .js files found under ${distDir} — did the build run?`,
		);
		process.exit(1);
	}
	const hits = [];
	for (const file of files) {
		const content = await readFile(file, "utf8");
		for (const { name, re } of KEY_PATTERNS) {
			const match = content.match(re);
			// Only a prefix is printed: this output lands in CI logs.
			if (match) hits.push({ file, name, preview: `${match[0].slice(0, 6)}…` });
		}
	}
	if (hits.length > 0) {
		console.error(
			"check-no-secrets-in-bundle: FAILED — key-shaped strings in the production bundle:",
		);
		for (const hit of hits)
			console.error(`  ${hit.file}: ${hit.name} (${hit.preview})`);
		process.exit(1);
	}
	console.log(
		`check-no-secrets-in-bundle: OK — scanned ${files.length} file(s), no key-shaped strings found.`,
	);
}

main();
