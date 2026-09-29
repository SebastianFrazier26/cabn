import {
	assertWorldLayerFits,
	type Biome,
	type ChunkFile,
	type Cluster,
	isWorldJsonErrorCode,
	type Portal,
	type RichPortalPreview,
	type SearchIndexFile,
	WORLD_LAYER_VERSION,
	type WorldChunk,
	type WorldLayerDelta,
	WorldLayerDeltaSchema,
	type WorldManifest,
	type WorldPath,
} from "@cabn/world-schema";
import { type AnnotateFileInput, annotateWorld } from "./annotate/run.js";
import { classify } from "./classify.js";
import { DEFAULT_MAX_FILES_PER_CLUSTER } from "./cluster.js";
import { shortHash } from "./hash.js";
import { markdownToStructuredPreview } from "./markdownPreview.js";
import { buildPreview } from "./preview.js";
import { buildCodePreview } from "./richPreview.js";
import { buildSearchIndex, type SearchDoc } from "./search-index.js";
import {
	placeShadowClusters,
	type ShadowPlacementNode,
} from "./shadowLayout.js";
import { buildSignIndex, isSeynPath } from "./signs.js";
import type { FileSource } from "./sources/types.js";
import {
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_MAX_FILES,
	isSecretPath,
	type WalkedFile,
	walk,
} from "./walk.js";

/**
 * The shadow realm: every hidden path (walk.ts's isHiddenPath) the normal
 * world leaves out, as a WorldLayerDelta over that world. Only `cabn serve
 * --owner` computes one, on demand, and never writes it into a bundle — so
 * this module is exported from the Node entry (index.ts) only, never from
 * browser.ts, and nothing a browser loads can reach it.
 */

export interface ConvertShadowOptions {
	/** Must match what the base world was converted with, so the visible files re-walked for annotation are the base's own. */
	ignore?: string[];
	maxFiles?: number;
	maxFileBytes?: number;
	maxFilesPerCluster?: number;
	now?: () => Date;
	/**
	 * Paths git tracks. A secret-named hidden file (`.env`, `.npmrc`, ...) is
	 * readable in the shadow realm, but it only gets monsters — the magpie
	 * among them — when it is tracked: an untracked `.env` holding keys is
	 * where keys belong, not a leak. Absent: treated as tracking nothing.
	 */
	trackedPaths?: ReadonlySet<string>;
}

const CABN_CONFIG_FILENAME = "cabn.json";
const BIOMES: readonly Biome[] = ["meadow", "grove", "glade"];
const decoder = new TextDecoder("utf-8", { fatal: false });

function slug(path: string): string {
	return path === "" ? "root" : path.replace(/\//g, "--");
}

function labelOf(path: string): string {
	return path === "" ? "root" : (path.split("/").pop() ?? path);
}

function dirOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

function byPath(a: { path: string }, b: { path: string }): number {
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	// WebCrypto, not node:crypto: the converter's sources stay node:*-free.
	const digest = await crypto.subtle.digest(
		"SHA-256",
		bytes as Uint8Array<ArrayBuffer>,
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

interface ShadowGroup {
	id: string;
	/** Folder path, "" for the root. */
	path: string;
	label: string;
	parentId: string;
	pathKind: WorldPath["kind"];
	biome: Biome;
	annexOf?: string;
	files: WalkedFile[];
}

interface DirNode {
	path: string;
	files: WalkedFile[];
	children: DirNode[];
}

function dirTree(rootPath: string, files: readonly WalkedFile[]): DirNode {
	const nodes = new Map<string, DirNode>();
	const root: DirNode = { path: rootPath, files: [], children: [] };
	nodes.set(rootPath, root);
	const ensure = (path: string): DirNode => {
		const existing = nodes.get(path);
		if (existing) return existing;
		const node: DirNode = { path, files: [], children: [] };
		nodes.set(path, node);
		ensure(dirOf(path)).children.push(node);
		return node;
	};
	for (const f of files) ensure(dirOf(f.path)).files.push(f);
	return root;
}

/**
 * Hidden files -> shadow clusters, parents before children. A dotfile sitting
 * directly in a visible folder joins that folder's annex `<clusterId>#shadow`;
 * a hidden folder becomes clusters of its own (empty pass-through folders
 * collapsed, as in the base world), hung off the nearest visible ancestor's
 * annex, or that ancestor's own cluster.
 */
function groupHiddenFiles(
	files: readonly WalkedFile[],
	base: WorldManifest,
	maxFilesPerCluster: number,
): ShadowGroup[] {
	const baseByFolder = new Map<string, Cluster>();
	for (const c of base.clusters)
		if (!c.annexOf) baseByFolder.set(c.path === "." ? "" : c.path, c);
	const used = new Set(base.clusters.map((c) => c.id));
	const unique = (candidate: string, disambiguator: string): string => {
		if (!used.has(candidate)) {
			used.add(candidate);
			return candidate;
		}
		let n = 0;
		let id = `${candidate}~${shortHash(disambiguator)}`;
		while (used.has(id))
			id = `${candidate}~${shortHash(`${disambiguator}#${++n}`)}`;
		used.add(id);
		return id;
	};
	const biomeOf = new Map(base.clusters.map((c) => [c.id, c.biome]));
	const nextBiome = (parentId: string): Biome => {
		const i = BIOMES.indexOf(biomeOf.get(parentId) ?? "meadow");
		return BIOMES[(i + 1) % BIOMES.length] ?? "meadow";
	};

	const direct = new Map<string, WalkedFile[]>();
	const inHiddenFolder = new Map<string, WalkedFile[]>();
	for (const f of files) {
		const segments = f.path.split("/");
		const i = segments.findIndex((s) => s.startsWith("."));
		if (i === segments.length - 1) {
			const folder = segments.slice(0, i).join("/");
			direct.set(folder, [...(direct.get(folder) ?? []), f]);
		} else {
			const top = segments.slice(0, i + 1).join("/");
			inHiddenFolder.set(top, [...(inHiddenFolder.get(top) ?? []), f]);
		}
	}

	const groups: ShadowGroup[] = [];
	const pushSharded = (
		group: Omit<ShadowGroup, "files">,
		all: WalkedFile[],
	) => {
		const sorted = [...all].sort(byPath);
		groups.push({ ...group, files: sorted.slice(0, maxFilesPerCluster) });
		for (
			let i = maxFilesPerCluster, n = 2;
			i < sorted.length;
			i += maxFilesPerCluster, n++
		) {
			groups.push({
				id: unique(`${group.id}__${n}`, `${group.path}#shadow-annex${n}`),
				path: group.path,
				label: `${group.label} (${n})`,
				parentId: group.id,
				pathKind: "trail",
				biome: group.biome,
				annexOf: group.id,
				files: sorted.slice(i, i + maxFilesPerCluster),
			});
		}
	};

	const nearestBase = (folder: string): Cluster => {
		let f = folder;
		for (;;) {
			const c = baseByFolder.get(f);
			if (c) return c;
			if (f === "") break;
			f = dirOf(f);
		}
		const root = base.clusters[0];
		if (!root) throw new Error("convertShadow: base world has no clusters");
		return root;
	};

	const annexByFolder = new Map<string, string>();
	for (const folder of [...direct.keys()].sort()) {
		const own = baseByFolder.get(folder);
		const anchor = own ?? nearestBase(folder);
		const id = unique(
			`${own ? own.id : slug(folder)}#shadow`,
			`${folder}#shadow`,
		);
		annexByFolder.set(folder, id);
		biomeOf.set(id, anchor.biome);
		pushSharded(
			{
				id,
				path: folder === "" ? "." : folder,
				label: labelOf(folder),
				parentId: anchor.id,
				pathKind: "trail",
				biome: anchor.biome,
				...(own ? { annexOf: own.id } : {}),
			},
			direct.get(folder) ?? [],
		);
	}

	const anchorFor = (visibleFolder: string): string => {
		let f = visibleFolder;
		for (;;) {
			const annex = annexByFolder.get(f);
			if (annex) return annex;
			const c = baseByFolder.get(f);
			if (c) return c.id;
			if (f === "") return nearestBase("").id;
			f = dirOf(f);
		}
	};

	const emit = (node: DirNode, parentId: string): void => {
		if (node.files.length === 0) {
			for (const child of node.children) emit(child, parentId);
			return;
		}
		const id = unique(slug(node.path), node.path);
		const biome = nextBiome(parentId);
		biomeOf.set(id, biome);
		pushSharded(
			{
				id,
				path: node.path,
				label: labelOf(node.path),
				parentId,
				pathKind: "vine",
				biome,
			},
			node.files,
		);
		for (const child of node.children) emit(child, id);
	};
	for (const top of [...inHiddenFolder.keys()].sort()) {
		const tree = dirTree(top, inHiddenFolder.get(top) ?? []);
		tree.children.sort(byPath);
		emit(tree, anchorFor(dirOf(top)));
	}
	return groups;
}

function richPreviewFor(
	info: ReturnType<typeof classify>,
	text: string | undefined,
): RichPortalPreview {
	// Hidden media is never shipped (no media/ assets, no media.json): a sealed chest.
	if (info.binary || text === undefined) return { kind: "sealed" };
	if (info.kind === "markdown") return markdownToStructuredPreview(text);
	return buildCodePreview(text, info.language);
}

export async function convertShadow(
	source: FileSource,
	baseManifest: WorldManifest,
	opts: ConvertShadowOptions = {},
): Promise<WorldLayerDelta> {
	const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const walkBase = {
		ignore: [...(opts.ignore ?? []), CABN_CONFIG_FILENAME],
		maxFiles: opts.maxFiles ?? DEFAULT_MAX_FILES,
		maxFileBytes,
	};
	const visible = await walk(source, walkBase);
	// includeSecrets reaches hidden files only: a visible .pem stays sealed
	// in the base world and has no place in the shadow realm.
	const hidden = await walk(source, {
		...walkBase,
		hidden: "only",
		includeSecrets: true,
	});
	const signFiles = hidden.files.filter((f) => isSeynPath(f.path));
	const hiddenFiles = hidden.files.filter((f) => !isSeynPath(f.path));

	const groups = groupHiddenFiles(
		hiddenFiles,
		baseManifest,
		opts.maxFilesPerCluster ?? DEFAULT_MAX_FILES_PER_CLUSTER,
	);
	const positions = placeShadowClusters(
		baseManifest,
		groups.map(
			(g): ShadowPlacementNode => ({
				id: g.id,
				parentId: g.parentId,
				portalCount: g.files.length,
			}),
		),
	);

	const clusters: Cluster[] = groups.map((g) => ({
		id: g.id,
		path: g.path,
		label: g.label,
		pos: positions.get(g.id) ?? { x: 0, y: 0 },
		biome: g.biome,
		portalIds: g.files.map((f) => f.path),
		chunk: `chunks/${g.id}.json`,
		...(g.annexOf ? { annexOf: g.annexOf } : {}),
	}));
	const paths: WorldPath[] = groups.map((g) => ({
		from: g.parentId,
		to: g.id,
		kind: g.pathKind,
	}));

	const fileClusterId = new Map<string, string>();
	for (const p of baseManifest.portals) fileClusterId.set(p.id, p.clusterId);
	for (const g of groups)
		for (const f of g.files) fileClusterId.set(f.path, g.id);

	const annotateInputs: AnnotateFileInput[] = [];
	const basePortalFiles = new Map(
		baseManifest.portals.map((p) => [p.id, p.file]),
	);
	for (const f of visible.files) {
		const file = basePortalFiles.get(f.path);
		if (!file) continue;
		annotateInputs.push({
			file,
			content:
				f.content && !file.binary ? decoder.decode(f.content) : undefined,
		});
	}

	const portals: Portal[] = [];
	const chunkMaps = new Map<string, Map<string, ChunkFile>>(
		groups.map((g) => [g.id, new Map()]),
	);
	const searchDocs: SearchDoc[] = [];
	const textSha256 = new Map<string, string>();
	const tracked = opts.trackedPaths ?? new Set<string>();
	for (const g of groups) {
		for (const f of g.files) {
			const text = f.content ? decoder.decode(f.content) : undefined;
			const info = classify(f.path, f.content);
			const name = f.path.split("/").pop() ?? f.path;
			const readable = text !== undefined && !info.binary;
			const portalFile = {
				path: f.path,
				name,
				kind: info.kind,
				language: info.language,
				bytes: f.bytes,
				lines: readable ? text.split("\n").length : undefined,
				binary: info.binary,
			};
			portals.push({
				id: f.path,
				clusterId: g.id,
				file: portalFile,
				preview: readable
					? buildPreview(text)
					: { lines: [], truncated: f.bytes > 0 },
				richPreview: richPreviewFor(info, text),
				spawns: [],
			});
			const annotatable = !isSecretPath(f.path) || tracked.has(f.path);
			annotateInputs.push({
				file: portalFile,
				content: readable && annotatable ? text : undefined,
			});
			if (readable && f.content) {
				chunkMaps.get(g.id)?.set(f.path, { content: text, encoding: "utf8" });
				searchDocs.push({ id: f.path, path: f.path, name, content: text });
				textSha256.set(f.path, await sha256Hex(f.content));
			}
		}
	}

	const shadowPortalIds = new Set(portals.map((p) => p.id));
	const shadowPathIds = new Set(paths.map((p) => `${p.from}::${p.to}`));
	const annotated = annotateWorld(annotateInputs, fileClusterId, [
		...baseManifest.paths,
		...paths,
	]);
	const kept = annotated.monsters.filter(
		(m) =>
			(m.portalId !== undefined && shadowPortalIds.has(m.portalId)) ||
			(m.pathId !== undefined && shadowPathIds.has(m.pathId)),
	);
	const monsters = kept.filter((m) => isWorldJsonErrorCode(m.error.code));
	const extendedMonsters = kept.filter(
		(m) => !isWorldJsonErrorCode(m.error.code),
	);
	const worldJsonIds = new Set(monsters.map((m) => m.id));
	for (const portal of portals) {
		const spawns = annotated.spawnsByPortalId
			.get(portal.id)
			?.filter((id) => worldJsonIds.has(id));
		if (spawns?.length) portal.spawns = spawns;
	}

	const signIndex = buildSignIndex(
		signFiles,
		[...baseManifest.portals, ...portals],
		[...baseManifest.clusters, ...clusters],
	);
	for (const doc of signIndex.searchDocs) searchDocs.push(doc);
	const searchIndex: SearchIndexFile = buildSearchIndex(searchDocs);

	const chunks: Record<string, WorldChunk> = Object.fromEntries(
		[...chunkMaps].map(([clusterId, files]) => [
			clusterId,
			{ clusterId, files: Object.fromEntries(files) },
		]),
	);

	const delta = WorldLayerDeltaSchema.parse({
		layerVersion: WORLD_LAYER_VERSION,
		baseGeneratedAt: baseManifest.meta.generatedAt,
		generatedAt: (opts.now?.() ?? new Date()).toISOString(),
		stats: {
			fileCount: hiddenFiles.length,
			totalBytes: hidden.totalBytes,
			truncated: hidden.truncated,
			skippedFiles: hidden.skippedFiles,
		},
		clusters,
		paths,
		portals,
		monsters,
		extendedMonsters,
		signs: signIndex.file.signs,
		textSha256: Object.fromEntries(textSha256),
		chunks,
		searchIndex,
	});
	assertWorldLayerFits(baseManifest, delta);
	return delta;
}
