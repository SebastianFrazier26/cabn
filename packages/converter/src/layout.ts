import { fnv1a } from "./hash.js";

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

// Halved from 900/120 (2026-09-21 world-hierarchy redesign): walking a
// multi-depth world to reach an inner cluster took too long at the original
// scale. Jitter is halved in lockstep with the ring radius so it stays the
// same fraction of ring spacing instead of overlapping neighboring rings.
const RING_RADIUS_PER_DEPTH = 450;
const JITTER_RANGE = 60;

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
		// Math.cos/Math.sin determinism is scoped to a single JS engine: V8
		// gives byte-identical output run to run (what our snapshot/byte-
		// stability tests rely on), but a different engine's last-ulp trig
		// rounding could disagree. Not a concern until worlds are compared
		// or hashed across engines.
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

// M10b batch 3: the radial angle-slicing above guarantees siblings under the
// *same* parent don't share an angle, but says nothing about the actual
// Cartesian distance between them (a narrow weighted slice can still land
// two siblings close together), and nothing at all about two clusters in
// *different* branches of the tree, which can land arbitrarily close since
// their angles are chosen independently. Batch-3 review: "the root cluster
// packs file arches tightly", "props... crowd and overlap" — a real gap in
// this algorithm, not just an engine-side scatter-radius problem.
//
// The required gap between two clusters isn't one flat number, though — a
// cluster with 40 files needs a much bigger clearing (to fit that many
// portal arches without them overlapping) than one with 2. This mirrors
// packages/engine/src/scenes/WorldScene.ts's portalRingRadius()/
// groundRadius() shape (weight here is file count, same thing
// WorldScene calls cluster.portalIds.length) — deliberately duplicated
// rather than imported, same as that file's own mulberry32 duplication note:
// converter has no other reason to depend on the engine package.
const ARCH_DISPLAY_SIZE_PX = 96; // PORTAL_ARCH_FRAME_SIZE (256) * PORTAL_SCALE (0.375), render/scale.ts
const ARCH_RING_SPACING_PX = ARCH_DISPLAY_SIZE_PX * 1.2;
const PORTAL_RING_MIN_RADIUS_PX = 100;
const CLEARING_OUTER_MARGIN_PX = 90;
const CLEARING_GAP_PX = 60; // visible gap between two clearings' *edges*, not just their centers

function estimatedClearingRadius(weight: number): number {
	const ringRadius =
		weight <= 1
			? PORTAL_RING_MIN_RADIUS_PX
			: Math.max(
					PORTAL_RING_MIN_RADIUS_PX,
					(weight * ARCH_RING_SPACING_PX) / (Math.PI * 2),
				);
	return ringRadius + CLEARING_OUTER_MARGIN_PX;
}

// A single pass only closes half the deficit between any one pair, and
// resolving one pair can nudge others back under the minimum — dense inputs
// (e.g. 20+ siblings sharing one ring) need more than a couple of passes to
// actually converge. 60 passes is still trivial work (O(n^2) per pass, and n
// is a cluster count — tens, not thousands) and empirically converges for
// every case this algorithm is actually exercised against (see layout.test.ts's
// many-siblings test).
const SEPARATION_PASSES = 60;

/**
 * Post-placement relaxation: a few fixed passes pushing any two cluster
 * centers closer than their combined clearing radii (+ a fixed gap) apart
 * directly away from each other, split evenly between them. A fixed pass
 * count (not "until stable") keeps this a bounded, deterministic amount of
 * work regardless of how a pathological input might oscillate. `rootId` is
 * never moved — every path/portal position in the engine is ultimately
 * relative to the root sitting at the origin.
 */
function enforceMinimumSeparation(
	out: Map<string, LayoutPosition>,
	weights: Map<string, number>,
	rootId: string,
): void {
	const ids = [...out.keys()].sort();
	const requiredGap = new Map<string, number>();
	for (const id of ids)
		requiredGap.set(id, estimatedClearingRadius(weights.get(id) ?? 1));

	for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				const idA = ids[i];
				const idB = ids[j];
				if (idA === undefined || idB === undefined) continue;
				const a = out.get(idA);
				const b = out.get(idB);
				if (!a || !b) continue;

				const minSeparation =
					(requiredGap.get(idA) ?? PORTAL_RING_MIN_RADIUS_PX) +
					(requiredGap.get(idB) ?? PORTAL_RING_MIN_RADIUS_PX) +
					CLEARING_GAP_PX;

				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy);
				if (dist >= minSeparation) continue;

				// Exact-coincidence fallback (astronomically unlikely given each id
				// gets its own jitter, but 0/0 would otherwise produce NaN
				// positions): push along the x-axis, direction picked from id
				// order so it's still deterministic rather than arbitrary.
				const push = (minSeparation - dist) / 2;
				const ux = dist > 0 ? dx / dist : idA < idB ? -1 : 1;
				const uy = dist > 0 ? dy / dist : 0;
				if (idA !== rootId)
					out.set(idA, { x: a.x - ux * push, y: a.y - uy * push });
				if (idB !== rootId)
					out.set(idB, { x: b.x + ux * push, y: b.y + uy * push });
			}
		}
	}
}

function collectWeights(node: LayoutTreeNode, out: Map<string, number>): void {
	out.set(node.id, node.weight);
	for (const child of node.children) collectWeights(child, out);
}

/** Pure: identical tree in -> identical positions out, every time. */
export function computeLayout(
	root: LayoutTreeNode,
): Map<string, LayoutPosition> {
	const out = new Map<string, LayoutPosition>();
	place(root, 0, 0, Math.PI * 2, out);
	const weights = new Map<string, number>();
	collectWeights(root, weights);
	enforceMinimumSeparation(out, weights, root.id);
	return out;
}
