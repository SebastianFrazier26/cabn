#!/usr/bin/env node
// Regenerates mini-python.zip from the mini-python/ fixture directory.
// Run manually after editing that fixture: node test/fixtures/make-zip.mjs
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "mini-python");
const outFile = join(here, "mini-python.zip");

async function collect(dir, root, out) {
	for (const dirent of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, dirent.name);
		if (dirent.isDirectory()) {
			await collect(full, root, out);
			continue;
		}
		const rel = relative(root, full).split(sep).join("/");
		out[rel] = await readFile(full);
	}
}

const files = {};
await collect(srcDir, srcDir, files);

const zipped = zipSync(files, { level: 0 });
await writeFile(outFile, zipped);
console.log(`Wrote ${outFile} (${Object.keys(files).length} files)`);
