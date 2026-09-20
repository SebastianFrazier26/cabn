export interface LayoutTreeNode {
	id: string;
	/** This node's own weight (typically file count), excluding descendants. */
	weight: number;
	children: LayoutTreeNode[];
}

export interface LayoutPosition {
	x: number;
	y: number;
}

const RING_RADIUS_PER_DEPTH = 900;
const JITTER_RANGE = 120;

// FNV-1a — cheap, deterministic, good enough distribution for jitter seeding.
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// mulberry32 — small seeded PRNG. Determinism (same tree -> same layout every
// run) requires seeding from the cluster path, never from Date.now() or
// insertion order.
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function jitter(id: string): LayoutPosition {
	const rand = mulberry32(fnv1a(id));
	return {
		x: (rand() * 2 - 1) * JITTER_RANGE,
		y: (rand() * 2 - 1) * JITTER_RANGE,
	};
}

function subtreeWeight(node: LayoutTreeNode): number {
	return node.children.reduce(
		(sum, child) => sum + subtreeWeight(child),
		Math.max(node.weight, 0),
	);
}

function place(
	node: LayoutTreeNode,
	depth: number,
	angleStart: number,
	angleEnd: number,
	out: Map<string, LayoutPosition>,
): void {
	if (depth === 0) {
		out.set(node.id, { x: 0, y: 0 });
	} else {
		const angle = (angleStart + angleEnd) / 2;
		const radius = depth * RING_RADIUS_PER_DEPTH;
		const j = jitter(node.id);
		out.set(node.id, {
			x: Math.cos(angle) * radius + j.x,
			y: Math.sin(angle) * radius + j.y,
		});
	}

	if (node.children.length === 0) return;

	const weighted = node.children.map((child) => ({
		child,
		weight: Math.max(subtreeWeight(child), 1),
	}));
	const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
	const span = angleEnd - angleStart;

	let cursor = angleStart;
	for (const { child, weight } of weighted) {
		const slice = (weight / totalWeight) * span;
		place(child, depth + 1, cursor, cursor + slice, out);
		cursor += slice;
	}
}

/** Pure: identical tree in -> identical positions out, every time. */
export function computeLayout(
	root: LayoutTreeNode,
): Map<string, LayoutPosition> {
	const out = new Map<string, LayoutPosition>();
	place(root, 0, 0, Math.PI * 2, out);
	return out;
}
