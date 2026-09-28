import {
	type AssetsFile,
	AssetsFileSchema,
	CABN_VERSION,
	type ChunkFile,
	EMBED_INDEX_FILENAME,
	EMBED_INDEX_VERSION,
	type EmbedCheckEntry,
	type EmbedIndexFile,
	EmbedIndexFileSchema,
	isWorldJsonErrorCode,
	MEDIA_INDEX_FILENAME,
	MEDIA_INDEX_VERSION,
	type MediaIndexFile,
	MediaIndexFileSchema,
	type MediaPreview,
	MONSTER_INDEX_FILENAME,
	MONSTER_INDEX_VERSION,
	type MonsterIndexFile,
	MonsterIndexFileSchema,
	type RichPortalPreview,
	type SearchIndexFile,
	SearchIndexFileSchema,
	validateManifest,
	type WorldChunk,
	WorldChunkSchema,
	type WorldManifest,
} from "@cabn/world-schema";
import type { ExternalFinding } from "./annotate/externalFindings.js";
import { type AnnotateFileInput, annotateWorld } from "./annotate/run.js";
import {
	checkOverrideTargetsExist,
	loadCabnConfig,
	resolveOverride,
} from "./cabnConfig.js";
import { classify } from "./classify.js";
import { buildClusters, DEFAULT_MAX_FILES_PER_CLUSTER } from "./cluster.js";
import { checkEmbedUrls, type EmbedCheckNetwork } from "./embedCheck.js";
import { fnv1a } from "./hash.js";
import { markdownToStructuredPreview } from "./markdownPreview.js";
import {
	isImageFormat,
	isUnsupportedMediaPath,
	MediaBudget,
	mediaFormatForPath,
	resolveMediaCaps,
} from "./media.js";
import { buildPreview } from "./preview.js";
import { buildCodePreview, buildImagePreview } from "./richPreview.js";
import { buildSearchIndex, type SearchDoc } from "./search-index.js";
import type { FileSource, SourceEntry } from "./sources/types.js";
import { buildClusterTree, buildDirTree } from "./tree.js";
import {
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_MAX_FILES,
	isSecretPath,
	type WalkedFile,
	walk,
} from "./walk.js";

interface MediaOutcome {
	/** What world.json carries — understood by every engine, including ones that predate media.json. */
	richPreview: RichPortalPreview;
	/** What media.json carries for engines that read it; absent for images, which world.json already describes fully. */
	media?: MediaPreview;
}

/**
 * The media path for one walked file whose extension claims an image/audio/
 * PDF type. Bytes come from walk() when it read them, otherwise straight from
 * the source entry — media caps (5 MB default) sit well above walk()'s text
 * cap (512 KB), and an over-cap file is rejected on its declared size before
 * anything is read.
 */
async function resolveMediaFile(
	file: WalkedFile,
	entries: Map<string, SourceEntry>,
	budget: MediaBudget,
	includeSecrets: boolean | undefined,
): Promise<MediaOutcome> {
	const sealed = (
		reason: Extract<MediaPreview, { kind: "sealed" }>["reason"],
	) => ({
		richPreview: { kind: "sealed" } as const,
		media: { kind: "sealed", reason } as const,
	});
	if (isUnsupportedMediaPath(file.path)) return sealed("unsupported");
	const claimed = mediaFormatForPath(file.path);
	if (!claimed) return sealed("unsupported");
	if (isSecretPath(file.path, includeSecrets)) return sealed("unread");
	if (!budget.fitsFileCap(file.bytes)) return sealed("too-large");

	let bytes = file.content;
	if (!bytes) {
		const entry = entries.get(file.path);
		bytes = entry ? await entry.read() : undefined;
	}
	// A source can list an entry it then won't hand over in full (ZipSource
	// returns empty bytes past its own per-entry cap) — never ship a partial.
	if (!bytes || bytes.length !== file.bytes) return sealed("unread");

	const admission = budget.admit(claimed, bytes);
	if (!admission.ok) return sealed(admission.reason);
	const asset = admission.assetPath;
	if (isImageFormat(admission.format)) {
		return { richPreview: buildImagePreview(asset, bytes) };
	}
	const fallback = { kind: "sealed" } as const;
	if (admission.format === "pdf") {
		return {
			richPreview: fallback,
			media: { kind: "pdf", asset, bytes: bytes.length },
		};
	}
	return {
		richPreview: fallback,
		media: {
			kind: "audio",
			asset,
			bytes: bytes.length,
			format: admission.format,
		},
	};
}

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
	/** Host ceiling on a single shipped media file — cabn.json's `media.maxFileBytes` can lower it, never raise past it. Unset: only the cabn.json/default cap applies. */
	mediaMaxFileBytes?: number;
	/** Host ceiling on all shipped media bytes, same precedence as mediaMaxFileBytes. */
	mediaMaxTotalBytes?: number;
	/**
	 * Findings from an external linter/scanner run (`fromSarif`/`fromEslintJson`/
	 * `parseFindingsFile`), turned into monsters alongside the built-in
	 * annotators'. A convert-time input, not a cabn.json field: results are
	 * produced per run by CI, not authored into the source tree, and an
	 * uploaded zip shouldn't be able to inject arbitrary monster text.
	 */
	findings?: readonly ExternalFinding[];
	/** The directory the external tool ran in, for resolving the absolute paths in its output. Defaults to `source`. */
	findingsRoot?: string;
	/**
	 * Enables the build-time framability check for url previews (see
	 * embedCheck.ts): one request per distinct url through this injected
	 * fetch. Absent means offline — convert() itself never touches the
	 * network, so a host that converts untrusted uploads (apps/backend) can't
	 * be turned into a request proxy by a cabn.json. cabn.json's
	 * `embedCheck: false` forces offline even when this is set.
	 */
	embedNetwork?: EmbedCheckNetwork;
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
	// Every shipped image/audio/PDF byte (default previews and cabn.json
	// overrides alike) goes through this one budget; its admitted assets are
	// merged into the bundle map at the end as media/<hash>.<ext>.
	const mediaBudget = new MediaBudget(
		resolveMediaCaps(cabnConfig, {
			maxFileBytes: opts.mediaMaxFileBytes,
			maxTotalBytes: opts.mediaMaxTotalBytes,
		}),
	);
	const mediaPreviews = new Map<string, MediaPreview>();

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
				mediaBudget,
			);
			richPreview = resolved.preview;
		} else if (
			info.binary &&
			(mediaFormatForPath(file.path) || isUnsupportedMediaPath(file.path))
		) {
			const outcome = await resolveMediaFile(
				file,
				sourceEntries,
				mediaBudget,
				opts.includeSecrets,
			);
			richPreview = outcome.richPreview;
			if (outcome.media) mediaPreviews.set(file.path, outcome.media);
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

	const annotated = annotateWorld(annotateInputs, fileClusterId, paths, {
		annotate: cabnConfig?.annotate,
		findings: opts.findings,
		findingsRoot: opts.findingsRoot ?? opts.source,
	});
	// Split by what an older engine can parse: see world-schema's monsters.ts.
	const monsters = annotated.monsters.filter((m) =>
		isWorldJsonErrorCode(m.error.code),
	);
	const extendedMonsters = annotated.monsters.filter(
		(m) => !isWorldJsonErrorCode(m.error.code),
	);
	const worldJsonIds = new Set(monsters.map((m) => m.id));
	for (const portal of portals) {
		const spawns = annotated.spawnsByPortalId
			.get(portal.id)
			?.filter((id) => worldJsonIds.has(id));
		if (spawns?.length) portal.spawns = spawns;
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
		...(cabnConfig?.guide !== undefined ? { guide: cabnConfig.guide } : {}),
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

	bundle.set(
		EMBED_INDEX_FILENAME,
		JSON.stringify(
			await buildEmbedIndex(
				portals,
				cabnConfig?.embedCheck === false ? undefined : opts.embedNetwork,
			),
			null,
			2,
		),
	);

	// Always written, even empty, so an engine that reads media.json can
	// fetch it unconditionally for any bundle this converter produced.
	const mediaIndex: MediaIndexFile = {
		mediaVersion: MEDIA_INDEX_VERSION,
		previews: Object.fromEntries(mediaPreviews),
		totalBytes: mediaBudget.totalBytes,
	};
	MediaIndexFileSchema.parse(mediaIndex);
	bundle.set(MEDIA_INDEX_FILENAME, JSON.stringify(mediaIndex, null, 2));
	// Always written, like media.json, so an engine can fetch it
	// unconditionally for any bundle this converter produced.
	const monsterIndex: MonsterIndexFile = {
		monstersVersion: MONSTER_INDEX_VERSION,
		monsters: extendedMonsters,
		...(annotated.findings ? { findings: annotated.findings } : {}),
	};
	MonsterIndexFileSchema.parse(monsterIndex);
	bundle.set(MONSTER_INDEX_FILENAME, JSON.stringify(monsterIndex, null, 2));
	for (const [assetPath, bytes] of mediaBudget.assets()) {
		bundle.set(assetPath, bytes);
	}

	return bundle;
}

/** Always written (like media.json) so its presence says "this converter knew about embed checks"; offline entries carry basis "offline" so a reader can tell "assumed" from "checked". */
async function buildEmbedIndex(
	portals: WorldManifest["portals"],
	net: EmbedCheckNetwork | undefined,
): Promise<EmbedIndexFile> {
	const urlByPortal = new Map<string, string>();
	for (const portal of portals) {
		if (portal.richPreview?.kind === "url")
			urlByPortal.set(portal.id, portal.richPreview.url);
	}
	const verdicts = net
		? await checkEmbedUrls(urlByPortal.values(), net)
		: new Map<string, EmbedCheckEntry>();
	// Map + fromEntries, not bracket assignment — same "__proto__" filename
	// hazard as the chunk maps above.
	const entries = new Map<string, EmbedCheckEntry>();
	for (const [portalId, url] of urlByPortal) {
		entries.set(
			portalId,
			verdicts.get(url) ?? { url, framable: true, basis: "offline" },
		);
	}
	const index: EmbedIndexFile = {
		embedsVersion: EMBED_INDEX_VERSION,
		mode: net ? "network" : "offline",
		entries: Object.fromEntries(entries),
	};
	return EmbedIndexFileSchema.parse(index);
}
