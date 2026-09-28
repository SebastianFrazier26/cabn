import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	convert,
	DirSource,
	type ExternalFinding,
	FindingsValidationError,
	parseFindingsFile,
	ZipSource,
} from "@cabn/converter";
import {
	type FindingsSummary,
	MONSTER_INDEX_FILENAME,
	parseMonsterIndex,
} from "@cabn/world-schema";

export interface BuildSummary {
	outDir: string;
	clusters: number;
	portals: number;
	bytes: number;
	elapsedMs: number;
	truncated: boolean;
	skippedFiles: number;
	/** world.json monsters plus monsters.json monsters. */
	monsters: number;
	/** Present only when --findings files were given. */
	findings?: FindingsSummary;
}

export interface BuildOptions {
	outDir?: string;
	/** Read secret-pattern files (.env, *.pem, id_rsa*, ...) normally instead of metadata-only. Default false. */
	includeSecrets?: boolean;
	/** ESLint JSON or SARIF results files to turn into monsters (`--findings`, repeatable). */
	findingsPaths?: string[];
}

// 50 MB: comfortably above a large monorepo's SARIF, well below anything that
// would make JSON.parse the slowest part of a build.
const MAX_FINDINGS_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Reads and validates each results file at the boundary: unreadable,
 * oversized, non-JSON, or schema-invalid input fails the build with the
 * file's name rather than silently producing a world without its monsters.
 */
export async function loadFindings(
	paths: readonly string[],
): Promise<ExternalFinding[]> {
	const all: ExternalFinding[] = [];
	for (const path of paths) {
		const raw = await readFile(resolve(path));
		if (raw.byteLength > MAX_FINDINGS_FILE_BYTES) {
			throw new Error(
				`findings file ${path} is over ${MAX_FINDINGS_FILE_BYTES} bytes`,
			);
		}
		let json: unknown;
		try {
			json = JSON.parse(raw.toString("utf8"));
		} catch (err) {
			throw new Error(
				`findings file ${path} is not valid JSON: ${(err as Error).message}`,
			);
		}
		try {
			all.push(...parseFindingsFile(json));
		} catch (err) {
			if (err instanceof FindingsValidationError) {
				throw new Error(`findings file ${path}: ${err.message}`);
			}
			throw err;
		}
	}
	return all;
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
	const findings = opts.findingsPaths?.length
		? await loadFindings(opts.findingsPaths)
		: undefined;
	const bundle = await convert(source, {
		name,
		source: resolvedInput,
		includeSecrets: opts.includeSecrets,
		findings,
		// Tools report paths relative to (or absolute under) the directory they
		// ran in, which for `cabn build <dir>` is that dir.
		findingsRoot: isZip ? undefined : resolvedInput,
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
		monsters: unknown[];
		meta: { totalBytes: number; truncated: boolean; skippedFiles: number };
	};

	const indexRaw = bundle.get(MONSTER_INDEX_FILENAME);
	const indexJson: unknown =
		typeof indexRaw === "string" ? JSON.parse(indexRaw) : undefined;
	const extraMonsters = parseMonsterIndex(indexJson).length;
	const findingsSummary = (
		indexJson as { findings?: FindingsSummary } | undefined
	)?.findings;

	return {
		outDir,
		clusters: manifest.clusters.length,
		portals: manifest.portals.length,
		bytes: manifest.meta.totalBytes,
		elapsedMs: Math.round(performance.now() - start),
		truncated: manifest.meta.truncated,
		skippedFiles: manifest.meta.skippedFiles,
		monsters: manifest.monsters.length + extraMonsters,
		...(findingsSummary ? { findings: findingsSummary } : {}),
	};
}
