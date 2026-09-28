import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
	convert,
	DirSource,
	type EmbedCheckNetwork,
	type EmbedFetch,
	ZipSource,
} from "@cabn/converter";
import { EMBED_INDEX_FILENAME, parseEmbedIndex } from "@cabn/world-schema";

export interface BuildSummary {
	outDir: string;
	clusters: number;
	portals: number;
	bytes: number;
	elapsedMs: number;
	truncated: boolean;
	skippedFiles: number;
	/** Url previews whose site refuses to be framed (build-time check); empty when offline. */
	embedBlocked: { portalId: string; url: string; detail?: string }[];
	embedCheck: "network" | "offline";
}

export interface BuildOptions {
	outDir?: string;
	/** Read secret-pattern files (.env, *.pem, id_rsa*, ...) normally instead of metadata-only. Default false. */
	includeSecrets?: boolean;
	/** Skip the build-time framability check for url previews (no network requests at all). */
	offline?: boolean;
}

/**
 * The CLI's opt-in to convert()'s network check: Node's own fetch, cast to
 * the structural shape the converter asks for. Only the CLI (a user running
 * cabn on their own project) does this — never apps/backend.
 */
export function cliEmbedNetwork(
	offline: boolean | undefined,
): EmbedCheckNetwork | undefined {
	if (offline) return undefined;
	return { fetch: globalThis.fetch as unknown as EmbedFetch };
}

/** Pulls blocked url previews out of a bundle's embeds.json for the CLI's summary line. */
export function embedSummary(bundle: Map<string, Uint8Array | string>): {
	mode: "network" | "offline";
	blocked: BuildSummary["embedBlocked"];
} {
	const raw = bundle.get(EMBED_INDEX_FILENAME);
	if (typeof raw !== "string") return { mode: "offline", blocked: [] };
	const json = JSON.parse(raw) as { mode?: string };
	const blocked: BuildSummary["embedBlocked"] = [];
	for (const [portalId, v] of parseEmbedIndex(json)) {
		if (!v.framable)
			blocked.push({
				portalId,
				url: v.url,
				...(v.detail !== undefined ? { detail: v.detail } : {}),
			});
	}
	return { mode: json.mode === "network" ? "network" : "offline", blocked };
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
		embedNetwork: cliEmbedNetwork(opts.offline),
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

	const embeds = embedSummary(bundle);
	return {
		outDir,
		clusters: manifest.clusters.length,
		portals: manifest.portals.length,
		bytes: manifest.meta.totalBytes,
		elapsedMs: Math.round(performance.now() - start),
		truncated: manifest.meta.truncated,
		skippedFiles: manifest.meta.skippedFiles,
		embedBlocked: embeds.blocked,
		embedCheck: embeds.mode,
	};
}
