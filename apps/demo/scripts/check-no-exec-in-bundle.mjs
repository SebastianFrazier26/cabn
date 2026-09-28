#!/usr/bin/env node
// Runs as a "postbuild" step (see package.json) — the M7 requirement that
// LocalRunProvider (real code execution) can never ship in a hosted/demo
// build isn't just a build-time constant (see @cabn/engine's
// src/local-exec.ts docs): this app's own source never imports
// "@cabn/engine/local-exec" at all, so there is no module-graph edge for a
// bundler to even have a chance of including. This script is the check that
// keeps that true — a regression (someone adding that import to App.tsx)
// fails the build immediately rather than silently shipping exec capability
// to the public portfolio demo.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

// Literal strings that only exist in LocalRunProvider/cabn serve's exec wire
// protocol — none of them are generic enough to false-positive on unrelated
// code, and all survive minification (they're wire-format string literals,
// not identifiers a minifier would rename).
const FORBIDDEN_MARKERS = [
	"x-cabn-token",
	"/exec",
	"installLocalRunProvider",
	"cabn serve",
	// Same guarantee for owner writes (2026-09-28): only cabn serve's host page
	// imports @cabn/engine/owner, whose wire strings these are. The engine's
	// sign item and editor UI still ship here, but inert — without the owner
	// client nothing can reach a write route.
	"x-cabn-owner-token",
	"/owner/signs/",
	"__CABN_OWNER_TOKEN__",
];

async function listJsFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await listJsFiles(full)));
		else if (entry.name.endsWith(".js")) files.push(full);
	}
	return files;
}

async function main() {
	const files = await listJsFiles(distDir);
	if (files.length === 0) {
		console.error(
			`check-no-exec-in-bundle: no .js files found under ${distDir} — did the build run?`,
		);
		process.exit(1);
	}

	const hits = [];
	for (const file of files) {
		const content = await readFile(file, "utf8");
		for (const marker of FORBIDDEN_MARKERS) {
			if (content.includes(marker)) hits.push({ file, marker });
		}
	}

	if (hits.length > 0) {
		console.error(
			"check-no-exec-in-bundle: FAILED — found local-exec markers in the production bundle:",
		);
		for (const hit of hits) console.error(`  ${hit.file}: "${hit.marker}"`);
		process.exit(1);
	}

	console.log(
		`check-no-exec-in-bundle: OK — scanned ${files.length} file(s), no local-exec markers found.`,
	);
}

main();
