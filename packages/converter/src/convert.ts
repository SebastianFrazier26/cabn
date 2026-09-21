import {
	type AssetsFile,
	AssetsFileSchema,
	CABN_VERSION,
	type ChunkFile,
	type SearchIndexFile,
	SearchIndexFileSchema,
	validateManifest,
	type WorldChunk,
	WorldChunkSchema,
	type WorldManifest,
} from "@cabn/world-schema";
import { classify } from "./classify.js";
import { buildClusters, DEFAULT_MAX_FILES_PER_CLUSTER } from "./cluster.js";
import { buildPreview } from "./preview.js";
import { buildSearchIndex, type SearchDoc } from "./search-index.js";
import type { FileSource } from "./sources/types.js";
import { buildClusterTree, buildDirTree } from "./tree.js";
import { DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILES, walk } from "./walk.js";

export interface ConvertOptions {
	/** World display name (meta.name). */
	name: string;
	/** Original path/zip identifier, stored as meta.source. */
	source: string;
	ignore?: string[];
	maxFiles?: number;
	maxFileBytes?: number;
	maxFilesPerCluster?: number;
	/** Read secret-pattern files (.env, *.pem, id_rsa*, ...) normally instead of metadata-only. Default false. */
	includeSecrets?: boolean;
	/** Injectable clock for deterministic meta.generatedAt in tests. */
	now?: () => Date;
}

export type WorldBundle = Map<string, Uint8Array | string>;

const decoder = new TextDecoder("utf-8", { fatal: false });

export async function convert(
	source: FileSource,
	opts: ConvertOptions,
): Promise<WorldBundle> {
	const walked = await walk(source, {
		ignore: opts.ignore,
		maxFiles: opts.maxFiles ?? DEFAULT_MAX_FILES,
		maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
		includeSecrets: opts.includeSecrets,
	});

	const dirTree = buildDirTree(walked.files);
	const clusterTree = buildClusterTree(dirTree);
	const { clusters, paths, fileClusterId } = buildClusters(clusterTree, {
		maxFilesPerCluster:
			opts.maxFilesPerCluster ?? DEFAULT_MAX_FILES_PER_CLUSTER,
	});

	// Built as Map<string, ChunkFile> and converted via Object.fromEntries at
	// the end, not a plain object assigned to via bracket notation — a file
	// literally named "__proto__" would otherwise hit Object.prototype's
	// __proto__ setter instead of creating an own property, silently
	// vanishing from the chunk instead of erroring.
	const chunkFileMaps = new Map<string, Map<string, ChunkFile>>();
	for (const cluster of clusters) {
		chunkFileMaps.set(cluster.id, new Map());
	}

	const searchDocs: SearchDoc[] = [];
	const portals: WorldManifest["portals"] = [];

	for (const file of walked.files) {
		const clusterId = fileClusterId.get(file.path);
		if (!clusterId) continue; // unreachable given buildClusters covers every walked file

		const text = file.content ? decoder.decode(file.content) : undefined;
		const info = classify(file.path, file.content);
		const name = file.path.split("/").pop() ?? file.path;

		const lines =
			text !== undefined && !info.binary ? text.split("\n").length : undefined;
		const preview =
			text !== undefined && !info.binary
				? buildPreview(text)
				: { lines: [], truncated: file.bytes > 0 };

		portals.push({
			id: file.path,
			clusterId,
			file: {
				path: file.path,
				name,
				kind: info.kind,
				language: info.language,
				bytes: file.bytes,
				lines,
				binary: info.binary,
			},
			preview,
			spawns: [],
		});

		if (text !== undefined && !info.binary) {
			chunkFileMaps
				.get(clusterId)
				?.set(file.path, { content: text, encoding: "utf8" });
			searchDocs.push({ id: file.path, path: file.path, name, content: text });
		}
	}

	const manifest: WorldManifest = {
		cabnVersion: CABN_VERSION,
		meta: {
			name: opts.name,
			source: opts.source,
			generatedAt: (opts.now?.() ?? new Date()).toISOString(),
			fileCount: walked.files.length,
			totalBytes: walked.totalBytes,
			truncated: walked.truncated,
			skippedFiles: walked.skippedFiles,
		},
		clusters,
		paths,
		portals,
		monsters: [],
	};
	validateManifest(manifest);

	const searchIndex: SearchIndexFile = buildSearchIndex(searchDocs);
	SearchIndexFileSchema.parse(searchIndex);

	const assets: AssetsFile = { atlases: [] };
	AssetsFileSchema.parse(assets);

	const bundle: WorldBundle = new Map();
	bundle.set("world.json", JSON.stringify(manifest, null, 2));
	for (const [clusterId, fileMap] of chunkFileMaps) {
		const chunk: WorldChunk = { clusterId, files: Object.fromEntries(fileMap) };
		WorldChunkSchema.parse(chunk);
		bundle.set(`chunks/${clusterId}.json`, JSON.stringify(chunk, null, 2));
	}
	bundle.set("search-index.json", JSON.stringify(searchIndex, null, 2));
	bundle.set("assets.json", JSON.stringify(assets, null, 2));

	return bundle;
}
