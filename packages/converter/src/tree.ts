import type { WalkedFile } from "./walk.js";

export interface DirNode {
	/** "" for the root. */
	path: string;
	files: WalkedFile[];
	children: DirNode[];
}

function dirOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
}

export function buildDirTree(files: WalkedFile[]): DirNode {
	const nodes = new Map<string, DirNode>();
	const root: DirNode = { path: "", files: [], children: [] };
	nodes.set("", root);

	function ensureDir(path: string): DirNode {
		const existing = nodes.get(path);
		if (existing) return existing;
		const node: DirNode = { path, files: [], children: [] };
		nodes.set(path, node);
		const parent = ensureDir(dirOf(path));
		parent.children.push(node);
		return node;
	}

	for (const file of files) {
		ensureDir(dirOf(file.path)).files.push(file);
	}
	return root;
}

export interface ClusterNode {
	/** Directory path this cluster represents; "" for root. */
	path: string;
	depth: number;
	files: WalkedFile[];
	children: ClusterNode[];
}

/**
 * Collapses directories with no files of their own (pass-throughs) so that
 * "one cluster per directory containing files" holds without producing empty
 * clusters for structural-only directories. The root is always kept, even
 * with zero direct files, so the world always has an anchor at depth 0.
 */
export function buildClusterTree(dir: DirNode): ClusterNode {
	// `depth` is the cluster-graph depth a node would get if it becomes a
	// cluster, not raw filesystem nesting — a chain of empty pass-through
	// directories must not push its first file-bearing descendant further out
	// in the radial layout than a sibling that happens to hold files directly.
	function collapse(node: DirNode, depth: number): ClusterNode[] {
		const isCluster = node.path === "" || node.files.length > 0;
		if (!isCluster) {
			return node.children.flatMap((child) => collapse(child, depth));
		}
		const children = node.children.flatMap((child) =>
			collapse(child, depth + 1),
		);
		return [{ path: node.path, depth, files: node.files, children }];
	}

	const [rootCluster] = collapse(dir, 0);
	if (!rootCluster) {
		throw new Error("buildClusterTree: root collapsed away unexpectedly");
	}
	return rootCluster;
}
