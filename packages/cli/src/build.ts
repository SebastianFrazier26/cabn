import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { convert, DirSource, ZipSource } from "@cabn/converter";

export interface BuildSummary {
	outDir: string;
	clusters: number;
	portals: number;
	bytes: number;
	elapsedMs: number;
	truncated: boolean;
	skippedFiles: number;
}

export interface BuildOptions {
	outDir?: string;
	/** Read secret-pattern files (.env, *.pem, id_rsa*, ...) normally instead of metadata-only. Default false. */
	includeSecrets?: boolean;
}

export async function runBuild(
	inputPath: string,
	opts: BuildOptions = {},
): Promise<BuildSummary> {
	const start = performance.now();
	const resolvedInput = resolve(inputPath);
	const isZip = extname(resolvedInput).toLowerCase() === ".zip";
	const name = isZip
		? basename(resolvedInput, extname(resolvedInput))
		: basename(resolvedInput);
	const outDir = resolve(opts.outDir ?? `./${name}-world`);

	const source = isZip
		? new ZipSource(await readFile(resolvedInput))
		: new DirSource(resolvedInput);
	const bundle = await convert(source, {
		name,
		source: resolvedInput,
		includeSecrets: opts.includeSecrets,
	});

	for (const [relPath, content] of bundle) {
		const dest = join(outDir, relPath);
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, content);
	}

	const manifestRaw = bundle.get("world.json");
	if (typeof manifestRaw !== "string") {
		throw new Error("convert() did not produce a world.json entry");
	}
	const manifest = JSON.parse(manifestRaw) as {
		clusters: unknown[];
		portals: unknown[];
		meta: { totalBytes: number; truncated: boolean; skippedFiles: number };
	};

	return {
		outDir,
		clusters: manifest.clusters.length,
		portals: manifest.portals.length,
		bytes: manifest.meta.totalBytes,
		elapsedMs: Math.round(performance.now() - start),
		truncated: manifest.meta.truncated,
		skippedFiles: manifest.meta.skippedFiles,
	};
}
