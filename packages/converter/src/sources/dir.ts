// The only file in @cabn/converter allowed to import node:* — everything else
// must stay browser-safe (enforced by test/node-imports.test.ts) so the
// `./browser` export can ship without this file.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileSource, SourceEntry } from "./types.js";

async function* walkDir(
	root: string,
	dir: string,
): AsyncGenerator<SourceEntry> {
	const dirents = await readdir(dir, { withFileTypes: true });
	for (const dirent of dirents) {
		const full = join(dir, dirent.name);
		if (dirent.isDirectory()) {
			yield* walkDir(root, full);
			continue;
		}
		if (!dirent.isFile()) continue;
		const path = relative(root, full).split(sep).join("/");
		const { size } = await stat(full);
		yield {
			path,
			bytes: size,
			read: () => readFile(full),
		};
	}
}

export class DirSource implements FileSource {
	constructor(private readonly rootPath: string) {}

	entries(): AsyncIterable<SourceEntry> {
		return walkDir(this.rootPath, this.rootPath);
	}
}
