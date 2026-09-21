import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { buildShelf } from "@cabn/converter";
import { validateManifest } from "@cabn/world-schema";

export interface ShelfSummary {
	outDir: string;
	worlds: number;
}

export interface ShelfOptions {
	outDir?: string;
	/** Shelf display name (meta.name). Defaults to "My Worlds". */
	name?: string;
}

// Windows path separators would otherwise leak into a URL the browser has to
// fetch relative to shelf.json's own location.
function toUrlPath(path: string): string {
	return sep === "/" ? path : path.split(sep).join("/");
}

export async function runShelf(
	bundleDirs: string[],
	opts: ShelfOptions = {},
): Promise<ShelfSummary> {
	const outDir = resolve(opts.outDir ?? "./shelf");
	await mkdir(outDir, { recursive: true });

	const worlds = await Promise.all(
		bundleDirs.map(async (bundleDir) => {
			const resolvedBundleDir = resolve(bundleDir);
			const raw = await readFile(join(resolvedBundleDir, "world.json"), "utf8");
			const manifest = validateManifest(JSON.parse(raw));
			const worldUrl = `${toUrlPath(relative(outDir, resolvedBundleDir))}/world.json`;
			return { name: manifest.meta.name, worldUrl, manifest };
		}),
	);

	const shelf = buildShelf(worlds, { name: opts.name });
	await writeFile(
		join(outDir, "shelf.json"),
		`${JSON.stringify(shelf, null, 2)}\n`,
	);

	return { outDir, worlds: shelf.worlds.length };
}
