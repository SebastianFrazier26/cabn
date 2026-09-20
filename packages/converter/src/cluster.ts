import type { Biome, Cluster, WorldPath } from "@cabn/world-schema";
import { computeLayout, type LayoutTreeNode } from "./layout.js";
import type { ClusterNode } from "./tree.js";
import type { WalkedFile } from "./walk.js";

export const DEFAULT_MAX_FILES_PER_CLUSTER = 40;

const BIOME_ROTATION: readonly Biome[] = ["meadow", "grove", "glade"];

function biomeForDepth(depth: number): Biome {
	// Modulo against a fixed-length array is always in range; the fallback
	// only exists to satisfy noUncheckedIndexedAccess, never to be hit.
	return BIOME_ROTATION[depth % BIOME_ROTATION.length] ?? "meadow";
}

function slugId(path: string): string {
	return path === "" ? "root" : path.replace(/\//g, "--");
}

function labelOf(path: string): string {
	if (path === "") return "root";
	return path.split("/").pop() ?? path;
}

interface ShardInfo {
	id: string;
	path: string;
	label: string;
	depth: number;
	files: WalkedFile[];
	annexOf?: string;
}

interface ShardGroup {
	main: ShardInfo;
	// Overflow shards of the same directory (>maxFilesPerCluster files),
	// connected to `main` by a 'trail' path — see buildClusters doc comment.
	annexes: ShardInfo[];
	childGroups: ShardGroup[];
}

function buildShardGroup(
	node: ClusterNode,
	maxFilesPerCluster: number,
): ShardGroup {
	const id = slugId(node.path);
	const label = labelOf(node.path);

	const chunks: WalkedFile[][] = [];
	for (let i = 0; i < node.files.length; i += maxFilesPerCluster) {
		chunks.push(node.files.slice(i, i + maxFilesPerCluster));
	}

	const main: ShardInfo = {
		id,
		path: node.path,
		label,
		depth: node.depth,
		files: chunks[0] ?? [], // no files at all (e.g. a pass-through root)
	};
	const annexes: ShardInfo[] = chunks.slice(1).map((files, i) => ({
		id: `${id}__${i + 2}`,
		path: node.path,
		label: `${label} (${i + 2})`,
		depth: node.depth,
		files,
		annexOf: id,
	}));

	return {
		main,
		annexes,
		childGroups: node.children.map((child) =>
			buildShardGroup(child, maxFilesPerCluster),
		),
	};
}

function flattenShards(
	group: ShardGroup,
	parentId: string | undefined,
	shards: ShardInfo[],
	paths: WorldPath[],
): void {
	shards.push(group.main);
	if (parentId) paths.push({ from: parentId, to: group.main.id, kind: "vine" });
	for (const annex of group.annexes) {
		shards.push(annex);
		paths.push({ from: group.main.id, to: annex.id, kind: "trail" });
	}
	for (const child of group.childGroups) {
		flattenShards(child, group.main.id, shards, paths);
	}
}

// Annexes ride along as extra siblings at the SAME depth/ring as their main
// shard (not nested a ring deeper) so overflow shards share their real
// directory's biome and don't read as a separate, deeper part of the tree.
function toLayoutNode(
	group: ShardGroup,
): [LayoutTreeNode, ...LayoutTreeNode[]] {
	const main: LayoutTreeNode = {
		id: group.main.id,
		weight: group.main.files.length,
		children: group.childGroups.flatMap(toLayoutNode),
	};
	const annexNodes: LayoutTreeNode[] = group.annexes.map((a) => ({
		id: a.id,
		weight: a.files.length,
		children: [],
	}));
	return [main, ...annexNodes];
}

export interface ClusterBuildResult {
	clusters: Cluster[];
	paths: WorldPath[];
	/** file path -> owning cluster id, including annex shard assignment. */
	fileClusterId: Map<string, string>;
}

export interface ClusterBuildOptions {
	maxFilesPerCluster?: number;
}

/**
 * Turns a compressed directory tree into world clusters: one per
 * file-bearing directory, split into `<id>__2`, `__3`, ... annexes past
 * maxFilesPerCluster files, wired together by 'vine' (parent directory) and
 * 'trail' (annex overflow) paths, positioned by the shared radial layout.
 */
export function buildClusters(
	root: ClusterNode,
	opts: ClusterBuildOptions = {},
): ClusterBuildResult {
	const maxFilesPerCluster =
		opts.maxFilesPerCluster ?? DEFAULT_MAX_FILES_PER_CLUSTER;
	const rootGroup = buildShardGroup(root, maxFilesPerCluster);

	const shards: ShardInfo[] = [];
	const paths: WorldPath[] = [];
	flattenShards(rootGroup, undefined, shards, paths);

	const [layoutRoot] = toLayoutNode(rootGroup);
	const positions = computeLayout(layoutRoot);

	const fileClusterId = new Map<string, string>();
	const clusters: Cluster[] = shards.map((shard) => {
		for (const file of shard.files) fileClusterId.set(file.path, shard.id);
		const pos = positions.get(shard.id) ?? { x: 0, y: 0 };
		const cluster: Cluster = {
			id: shard.id,
			path: shard.path === "" ? "." : shard.path,
			label: shard.label,
			pos,
			biome: biomeForDepth(shard.depth),
			portalIds: shard.files.map((f) => f.path),
			chunk: `chunks/${shard.id}.json`,
		};
		return shard.annexOf ? { ...cluster, annexOf: shard.annexOf } : cluster;
	});

	return { clusters, paths, fileClusterId };
}
