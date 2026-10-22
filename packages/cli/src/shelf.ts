import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { buildShelf } from "@cabn/converter";
import {
	collectEmbedOrigins,
	EMPTY_SHOWCASE,
	parseShowcase,
	SHOWCASE_FILENAME,
	type Showcase,
	validateManifest,
	type WorldManifest,
} from "@cabn/world-schema";

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

/** A bundle from before showcase.json (or with an unreadable one) is a world with no showcase info, never a failed shelf. */
async function readShowcase(bundleDir: string): Promise<Showcase> {
	try {
		return parseShowcase(
			JSON.parse(await readFile(join(bundleDir, SHOWCASE_FILENAME), "utf8")),
		);
	} catch {
		return EMPTY_SHOWCASE;
	}
}

async function readManifest(bundleDir: string): Promise<WorldManifest> {
	const raw = await readFile(join(resolve(bundleDir), "world.json"), "utf8");
	return validateManifest(JSON.parse(raw));
}

/**
 * Every origin any of these built worlds may embed (their world.json
 * allowedEmbedOrigins, cabn.json sites included), sorted and deduplicated:
 * the `frame-src` list for a host page serving them.
 */
export async function collectWorldEmbedOrigins(
	bundleDirs: readonly string[],
): Promise<string[]> {
	return collectEmbedOrigins(await Promise.all(bundleDirs.map(readManifest)));
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
			const showcase = await readShowcase(resolvedBundleDir);
			return { name: manifest.meta.name, worldUrl, manifest, showcase };
		}),
	);

	const shelf = buildShelf(worlds, { name: opts.name });
	await writeFile(
		join(outDir, "shelf.json"),
		`${JSON.stringify(shelf, null, 2)}\n`,
	);

	return { outDir, worlds: shelf.worlds.length };
}
