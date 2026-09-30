#!/usr/bin/env node
// Postbuild check (see package.json), alongside check-no-exec-in-bundle.mjs
// and check-no-secrets-in-bundle.mjs: the shadow realm (hidden files) is
// owner-only — `cabn serve --owner` computes it on demand and never bundles
// it — so a hosted/demo build must carry neither its client code nor any
// hidden path. Two halves:
//  1. dist/**/*.js holds none of the shadow realm's wire strings or client
//     names, and no `shadow/` asset folder exists anywhere in dist;
//  2. every world manifest, chunk, search index and signs file under
//     dist/worlds and public/worlds names no path with a hidden segment.
//     The git history (the `git/` directory: pack, files.json, meta.json)
//     and releases.json are skipped on purpose: the git pack keeps hidden
//     blobs faithfully (secret-named blobs still omitted), by design.
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, "..");
const distDir = join(demoRoot, "dist");

const FORBIDDEN_JS_MARKERS = [
	"/owner/shadow/",
	"/assets/shadow/",
	"createShadowLayer",
	"createOwnerShadowClient",
	"__CABN_SHADOW",
];

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function listFiles(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listFiles(full)));
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

async function listDirs(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const full = join(dir, entry.name);
		out.push(full, ...(await listDirs(full)));
	}
	return out;
}

const isHiddenPath = (path) =>
	typeof path === "string" && path.split("/").some((s) => s.startsWith("."));

/** The world-relative paths a bundle file names, by file kind; null for files this check doesn't read. */
function namedPaths(fileName, json) {
	if (fileName === "world.json") {
		return [
			...(json.portals ?? []).flatMap((p) => [p.id, p.file?.path]),
			...(json.clusters ?? []).flatMap((c) => [
				c.path === "." ? "" : c.path,
				...(c.portalIds ?? []),
			]),
		];
	}
	if (fileName === "signs.json") return (json.signs ?? []).map((s) => s.path);
	if (fileName === "search-index.json") {
		const index = json.index ?? {};
		return [
			...Object.values(index.documentIds ?? {}),
			...Object.values(index.storedFields ?? {}).map((f) => f?.path),
		];
	}
	return null;
}

async function scanWorlds(root, hits) {
	if (!(await exists(root))) return 0;
	let scanned = 0;
	for (const file of await listFiles(root)) {
		const rel = relative(root, file).split(sep);
		// git/ (the git pack) and releases.json are exempt, see above.
		if (rel.some((s) => s === "git" || s === "releases.json")) continue;
		const name = basename(file);
		const isChunk = rel.at(-2) === "chunks" && name.endsWith(".json");
		if (!isChunk && namedPaths(name, {}) === null) continue;
		let json;
		try {
			json = JSON.parse(await readFile(file, "utf8"));
		} catch {
			hits.push({ file, detail: "not valid JSON" });
			continue;
		}
		const paths = isChunk
			? Object.keys(json.files ?? {})
			: (namedPaths(name, json) ?? []);
		for (const p of paths) {
			if (isHiddenPath(p)) hits.push({ file, detail: `hidden path "${p}"` });
		}
		scanned++;
	}
	return scanned;
}

async function main() {
	if (!(await exists(distDir))) {
		console.error(
			`check-no-shadow-in-bundle: ${distDir} does not exist — did the build run?`,
		);
		process.exit(1);
	}
	const hits = [];

	const jsFiles = (await listFiles(distDir)).filter((f) => f.endsWith(".js"));
	if (jsFiles.length === 0) {
		console.error("check-no-shadow-in-bundle: no .js files found under dist");
		process.exit(1);
	}
	for (const file of jsFiles) {
		const content = await readFile(file, "utf8");
		for (const marker of FORBIDDEN_JS_MARKERS)
			if (content.includes(marker))
				hits.push({ file, detail: `marker "${marker}"` });
	}
	for (const d of await listDirs(distDir)) {
		if (basename(d).toLowerCase() === "shadow")
			hits.push({ file: d, detail: "shadow/ asset folder" });
	}

	const worldFiles =
		(await scanWorlds(join(distDir, "worlds"), hits)) +
		(await scanWorlds(join(demoRoot, "public", "worlds"), hits));
	if (worldFiles === 0) {
		console.error(
			"check-no-shadow-in-bundle: no world files found under dist/worlds or public/worlds",
		);
		process.exit(1);
	}

	if (hits.length > 0) {
		console.error(
			"check-no-shadow-in-bundle: FAILED — shadow realm data or code in the production build:",
		);
		for (const hit of hits) console.error(`  ${hit.file}: ${hit.detail}`);
		console.error(
			"A world built before hidden files left normal worlds (2026-09-28) needs `pnpm -F @cabn/demo build:world -- --force`.",
		);
		process.exit(1);
	}
	console.log(
		`check-no-shadow-in-bundle: OK — scanned ${jsFiles.length} script(s) and ${worldFiles} world file(s), nothing hidden.`,
	);
}

main();
