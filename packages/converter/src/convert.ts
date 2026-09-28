import {
	type AssetsFile,
	AssetsFileSchema,
	CABN_VERSION,
	type ChunkFile,
	type RichPortalPreview,
	type SearchIndexFile,
	SearchIndexFileSchema,
	validateManifest,
	type WorldChunk,
	WorldChunkSchema,
	type WorldManifest,
} from "@cabn/world-schema";
import { type AnnotateFileInput, annotateWorld } from "./annotate/run.js";
import {
	checkOverrideTargetsExist,
	loadCabnConfig,
	resolveOverride,
} from "./cabnConfig.js";
import { classify } from "./classify.js";
import { buildClusters, DEFAULT_MAX_FILES_PER_CLUSTER } from "./cluster.js";
import { fnv1a } from "./hash.js";
import { markdownToStructuredPreview } from "./markdownPreview.js";
import { buildPreview } from "./preview.js";
import { buildCodePreview, buildImagePreview } from "./richPreview.js";
import { buildSearchIndex, type SearchDoc } from "./search-index.js";
import type { FileSource } from "./sources/types.js";
import { buildClusterTree, buildDirTree } from "./tree.js";
import { DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILES, walk } from "./walk.js";

// cabn.json is world config, not browsable content — it never gets a portal
// of its own. A filename collision deeper in the tree is ignored too, same
// as any other DEFAULT_IGNORES entry (the converter only ever reads the copy
// at the source root, via loadCabnConfig's own independent entries scan).
const CABN_CONFIG_FILENAME = "cabn.json";

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
	const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

	// Drains source.entries() once up front for cabn.json + override lookups;
	// walk() below drains it again for the normal file walk (see
	// LoadedCabnConfig's doc comment for why that's an accepted, documented
	// double-decompression cost on zip sources for now).
	const { config: cabnConfig, entries: sourceEntries } =
		await loadCabnConfig(source);

	const walked = await walk(source, {
		ignore: [...(opts.ignore ?? []), CABN_CONFIG_FILENAME],
		maxFiles: opts.maxFiles ?? DEFAULT_MAX_FILES,
		maxFileBytes,
		includeSecrets: opts.includeSecrets,
	});

	if (cabnConfig) {
		checkOverrideTargetsExist(
			cabnConfig,
			new Set(walked.files.map((f) => f.path)),
		);
	}

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
	const annotateInputs: AnnotateFileInput[] = [];
	// assets/previews/<hash> entries from resolved image previews (default and
	// cabn.json overrides alike) — merged into the bundle map at the end.
	const previewAssets = new Map<string, Uint8Array>();

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

		const portalFile = {
			path: file.path,
			name,
			kind: info.kind,
			language: info.language,
			bytes: file.bytes,
			lines,
			binary: info.binary,
		};

		const override = cabnConfig?.previews[file.path];
		let richPreview: RichPortalPreview;
		if (override) {
			const resolved = await resolveOverride(
				file.path,
				override,
				sourceEntries,
				maxFileBytes,
			);
			richPreview = resolved.preview;
			for (const [assetPath, bytes] of resolved.assets) {
				previewAssets.set(assetPath, bytes);
			}
		} else if (info.kind === "image") {
			if (file.content) {
				const built = buildImagePreview(file.path, file.content);
				richPreview = built.preview;
				previewAssets.set(built.assetPath, file.content);
			} else {
				// Oversized or secret-patterned — walk() never gave us content to copy.
				richPreview = { kind: "sealed" };
			}
		} else if (info.binary) {
			richPreview = { kind: "sealed" };
		} else if (text === undefined) {
			richPreview = { kind: "sealed" };
		} else if (info.kind === "markdown") {
			richPreview = markdownToStructuredPreview(text);
		} else {
			richPreview = buildCodePreview(text, info.language);
		}

		portals.push({
			id: file.path,
			clusterId,
			file: portalFile,
			preview,
			richPreview,
			spawns: [],
		});
		annotateInputs.push({
			file: portalFile,
			content: text !== undefined && !info.binary ? text : undefined,
		});

		if (text !== undefined && !info.binary) {
			chunkFileMaps
				.get(clusterId)
				?.set(file.path, { content: text, encoding: "utf8" });
			searchDocs.push({ id: file.path, path: file.path, name, content: text });
		}
	}

	const { monsters, spawnsByPortalId } = annotateWorld(
		annotateInputs,
		fileClusterId,
		paths,
	);
	for (const portal of portals) {
		const spawns = spawnsByPortalId.get(portal.id);
		if (spawns) portal.spawns = spawns;
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
			// Seeded from the source path/name, not the content, so re-converting
			// the same project keeps the same cabin/interior tint across runs.
			themeSeed: fnv1a(opts.source),
		},
		clusters,
		paths,
		portals,
		monsters,
		allowedEmbedOrigins: cabnConfig?.allowedEmbedOrigins ?? [],
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
	for (const [assetPath, bytes] of previewAssets) {
		bundle.set(assetPath, bytes);
	}

	return bundle;
}
