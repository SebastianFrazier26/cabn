import { fnv1a } from "./hash.js";

export interface LayoutTreeNode {
	id: string;
	/** This node's own weight (typically file count), excluding descendants. */
	weight: number;
	children: LayoutTreeNode[];
	/** A floor on this node's arch-ring radius (the root's, when a hero site stands inside it). */
	minRingRadius?: number;
}

export interface LayoutPosition {
	x: number;
	y: number;
}

// Halved from 900/120 (2026-09-21 world-hierarchy redesign): walking a
// multi-depth world to reach an inner cluster took too long at the original
// scale. Jitter is halved in lockstep with the ring radius so it stays the
// same fraction of ring spacing instead of overlapping neighboring rings.
// 2026-09-28: back up to 600 with the 2x world portal arches — a weight-1
// clearing's estimatedClearingRadius() is now 270px, so a parent/child pair
// needs 600px (2x270 + CLEARING_GAP_PX) and a 450px ring had separateClusters()
// shoving every depth-1 cluster off its ring. Walks are ~33% longer in px,
// but everything along them is drawn 2x larger, so they read about the same.
// 2026-11-17: there are no fixed rings any more, so this is only the floor
// for solveRadii()'s search steps; real distances come from the clearings.
const RING_RADIUS_PER_DEPTH = 600;
const JITTER_RANGE = 60;
const OPEN_STEP_PX = 100;
const OPEN_STEP_BUDGET = 400;
// A clearing keeps this much beyond its radius inside its wedge: jitter moves
// a node up to ~85px, and the wedge is what keeps neighbors off each other.
// Paths are tested against a slightly smaller margin so a clear radius
// always exists.
const WEDGE_MARGIN_PX = 90;
const PATH_MARGIN_PX = 80;
// A child far to the side of a parent that is itself far out can have no clear
// radius at all; past this multiple of its own radius it stays put instead of
// flying off, and the separation guard takes over.
const MAX_PATH_PUSH = 4;

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

interface NodeInfo {
	node: LayoutTreeNode;
	depth: number;
	parent: NodeInfo | undefined;
	children: NodeInfo[];
	clearingRadius: number;
	/** Angular slice of the full circle this node's subtree owns. */
	sectorStart: number;
	sectorEnd: number;
}

function collectInfo(
	node: LayoutTreeNode,
	depth: number,
	parent: NodeInfo | undefined,
	out: NodeInfo[],
): NodeInfo {
	const clearingRadius = Math.max(
		estimatedClearingRadius(
			Math.max(node.weight, 0),
			node.children.length + (parent ? 1 : 0),
		),
		(node.minRingRadius ?? 0) + CLEARING_OUTER_MARGIN_PX,
	);
	const info: NodeInfo = {
		node,
		depth,
		parent,
		children: [],
		clearingRadius,
		sectorStart: 0,
		sectorEnd: 0,
	};
	out.push(info);
	info.children = node.children.map((child) =>
		collectInfo(child, depth + 1, info, out),
	);
	return info;
}

/**
 * Distance from the origin for every node: the parent's distance plus
 * parent radius + own radius + the gap + `extra`, so each parent/child pair
 * sits the same edge-to-edge distance apart whatever its siblings or cousins
 * look like. A big cluster on one branch no longer pushes unrelated branches
 * outward the way a shared ring radius did.
 */
function nodeRadii(
	rootInfo: NodeInfo,
	extra: readonly number[],
): Map<NodeInfo, number> {
	const radiusOf = new Map<NodeInfo, number>([[rootInfo, 0]]);
	const walk = (info: NodeInfo): void => {
		const radius = radiusOf.get(info) ?? 0;
		for (const child of info.children) {
			radiusOf.set(
				child,
				radius +
					info.clearingRadius +
					child.clearingRadius +
					CLEARING_GAP_PX +
					(extra[child.depth] ?? 0),
			);
			walk(child);
		}
	};
	walk(rootInfo);
	return radiusOf;
}

/**
 * A node's own clearing, plus WEDGE_MARGIN_PX, must sit inside its angular
 * wedge. Two nodes in different wedges then never overlap and a path inside
 * one wedge never meets a clearing of another, wherever on the plane each
 * lies: that is what lets nodes sit at different distances from the origin
 * without a shared ring keeping them apart.
 */
function wedgeAngle(info: NodeInfo, radius: number): number {
	const half = info.clearingRadius + WEDGE_MARGIN_PX;
	return 2 * Math.asin(Math.min(1, half / Math.max(radius, half)));
}

function wedgeRadius(info: NodeInfo, angle: number): number {
	const half = info.clearingRadius + WEDGE_MARGIN_PX;
	return angle >= Math.PI ? 0 : half / Math.sin(angle / 2);
}

/**
 * Angle (radians) a subtree must own so its nodes fit side by side: the node
 * itself on its own radius, or all its children's subtrees together,
 * whichever is wider. The old model measured this as arc length, which
 * implicitly put every leaf descendant on one circle; in angle, a node
 * farther out needs less because the same arc spans fewer radians.
 */
function angleDemand(
	info: NodeInfo,
	radiusOf: Map<NodeInfo, number>,
	memo: Map<NodeInfo, number>,
): number {
	const own = wedgeAngle(info, radiusOf.get(info) ?? 1);
	let below = 0;
	for (const child of info.children)
		below += angleDemand(child, radiusOf, memo);
	const demand = Math.max(own, below);
	memo.set(info, demand);
	return demand;
}

/**
 * Whether the path from the parent to `child` stays clear of every sibling's
 * clearing, and `child`'s clearing stays clear of every sibling's path, when
 * `child` sits at `radius` and the siblings at their current radii. A child
 * far to the side of a parent that is close in radially is reached by a path
 * that runs along the arc and grazes the siblings between.
 */
function pathClearOfSiblings(
	parentX: number,
	parentY: number,
	child: NodeInfo,
	radius: number,
	siblings: readonly NodeInfo[],
	radiusOf: Map<NodeInfo, number>,
): boolean {
	const at = (info: NodeInfo, r: number) => {
		const angle = (info.sectorStart + info.sectorEnd) / 2;
		return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
	};
	const grazes = (
		end: { x: number; y: number },
		clearing: { x: number; y: number },
		reach: number,
	) => {
		const dx = end.x - parentX;
		const dy = end.y - parentY;
		const lengthSq = dx * dx + dy * dy;
		const t =
			lengthSq > 0
				? Math.max(
						0,
						Math.min(
							1,
							((clearing.x - parentX) * dx + (clearing.y - parentY) * dy) /
								lengthSq,
						),
					)
				: 0;
		return (
			Math.hypot(
				clearing.x - (parentX + t * dx),
				clearing.y - (parentY + t * dy),
			) < reach
		);
	};
	const own = at(child, radius);
	for (const sibling of siblings) {
		if (sibling === child) continue;
		const other = at(sibling, radiusOf.get(sibling) ?? 0);
		if (grazes(own, other, sibling.clearingRadius + PATH_MARGIN_PX))
			return false;
		if (grazes(other, own, child.clearingRadius + PATH_MARGIN_PX)) return false;
	}
	return true;
}

/**
 * solveRadii() lengthens whole depths until the angle fits, so nodes that sit
 * in roomy wedges are still farther out than they need to be. With the wedges
 * fixed, a node only has to be one step beyond its parent and far enough out
 * that its own wedge, and (one step further in) each descendant's wedge, hold
 * their clearings. The `solved` radius caps the floor: it is always enough, and
 * a larger radius only widens what a wedge can hold. Siblings share a parent,
 * so their radii are then pushed out one at a time until no path grazes a
 * sibling's clearing.
 */
function tighten(
	rootInfo: NodeInfo,
	solved: Map<NodeInfo, number>,
): Map<NodeInfo, number> {
	const step = (parent: NodeInfo, child: NodeInfo) =>
		parent.clearingRadius + child.clearingRadius + CLEARING_GAP_PX;
	const floor = new Map<NodeInfo, number>();
	const lift = (info: NodeInfo): number => {
		const arc = info.sectorEnd - info.sectorStart;
		let min = arc > 0 ? wedgeRadius(info, arc) : 0;
		for (const child of info.children)
			min = Math.max(min, lift(child) - step(info, child));
		floor.set(info, min);
		return min;
	};
	lift(rootInfo);
	const radiusOf = new Map<NodeInfo, number>([[rootInfo, 0]]);
	const angleOf = (info: NodeInfo) => (info.sectorStart + info.sectorEnd) / 2;
	const walk = (info: NodeInfo): void => {
		const radius = radiusOf.get(info) ?? 0;
		const from = angleOf(info);
		for (const child of info.children)
			radiusOf.set(
				child,
				Math.max(
					radius + step(info, child),
					Math.min(solved.get(child) ?? 0, floor.get(child) ?? 0),
				),
			);
		const px = Math.cos(from) * radius;
		const py = Math.sin(from) * radius;
		if (info.children.length > 1) {
			for (const child of info.children) {
				const clear = (r: number) =>
					pathClearOfSiblings(px, py, child, r, info.children, radiusOf);
				const start = radiusOf.get(child) ?? 0;
				if (clear(start)) continue;
				let lo = start;
				let hi = start * 2 + RING_RADIUS_PER_DEPTH;
				const limit = start * MAX_PATH_PUSH;
				while (!clear(hi) && hi < limit) {
					lo = hi;
					hi *= 2;
				}
				if (!clear(hi)) continue;
				for (let i = 0; i < 30; i++) {
					const mid = (lo + hi) / 2;
					if (clear(mid)) hi = mid;
					else lo = mid;
				}
				radiusOf.set(child, hi);
			}
		}
		for (const child of info.children) walk(child);
	};
	walk(rootInfo);
	return radiusOf;
}

/**
 * Opens the rings only where the tree is actually crowded. Start with every
 * edge at the bare minimum gap; while the angle demand overflows a full
 * circle, lengthen the edges into whichever depth buys the most relief per
 * edge lengthened (a ring that holds many nodes is worth opening, a ring of
 * three is not). Ties break toward the shallower depth, so the whole
 * procedure is deterministic. If the step budget runs out, a uniform
 * bisection finishes the job so the result always fits.
 */
function solveRadii(
	rootInfo: NodeInfo,
	infos: NodeInfo[],
): {
	radiusOf: Map<NodeInfo, number>;
	demand: Map<NodeInfo, number>;
} {
	const maxDepth = infos.reduce((m, i) => Math.max(m, i.depth), 0);
	const edgesAt = new Array<number>(maxDepth + 1).fill(0);
	for (const info of infos)
		edgesAt[info.depth] = (edgesAt[info.depth] ?? 0) + 1;
	const attempt = (extra: readonly number[]) => {
		const radiusOf = nodeRadii(rootInfo, extra);
		const demand = new Map<NodeInfo, number>();
		let total = 0;
		for (const child of rootInfo.children)
			total += angleDemand(child, radiusOf, demand);
		return { radiusOf, demand, total };
	};
	const extra = new Array<number>(maxDepth + 1).fill(0);
	let current = attempt(extra);
	for (let step = 0; step < OPEN_STEP_BUDGET; step++) {
		if (current.total <= Math.PI * 2) return current;
		let bestDepth = -1;
		let bestValue = 0;
		let best = current;
		for (let depth = 1; depth <= maxDepth; depth++) {
			extra[depth] = (extra[depth] ?? 0) + OPEN_STEP_PX;
			const trial = attempt(extra);
			extra[depth] = (extra[depth] ?? 0) - OPEN_STEP_PX;
			const value =
				(current.total - trial.total) /
				((edgesAt[depth] ?? 1) * (2 * (extra[depth] ?? 0) + OPEN_STEP_PX));
			if (value > bestValue) {
				bestValue = value;
				bestDepth = depth;
				best = trial;
			}
		}
		if (bestDepth < 0) break;
		extra[bestDepth] = (extra[bestDepth] ?? 0) + OPEN_STEP_PX;
		current = best;
	}
	const base = extra.slice();
	const uniform = (more: number) =>
		attempt(base.map((e, depth) => (depth === 0 ? 0 : e + more)));
	let lo = 0;
	let hi = RING_RADIUS_PER_DEPTH;
	while (uniform(hi).total > Math.PI * 2) {
		lo = hi;
		hi *= 2;
	}
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (uniform(mid).total > Math.PI * 2) lo = mid;
		else hi = mid;
	}
	return uniform(hi);
}

// 2026-09-28 playtest round 2 ("portals are still spaced kind of weirdly"):
// slices used to be proportional to raw file count, so a one-file directory
// got a sliver next to a busy sibling and enforceMinimumSeparation() then
// shoved the crowded ones outward along arbitrary axes. Slicing by the angle
// each subtree demands gives equal-footprint siblings equal angles; spare
// angle is shared out in the same proportion.
function assignSectors(info: NodeInfo, demand: Map<NodeInfo, number>): void {
	const total = info.children.reduce((sum, c) => sum + (demand.get(c) ?? 0), 0);
	const span = info.sectorEnd - info.sectorStart;
	let cursor = info.sectorStart;
	for (const child of info.children) {
		const slice = total > 0 ? ((demand.get(child) ?? 0) / total) * span : 0;
		child.sectorStart = cursor;
		child.sectorEnd = cursor + slice;
		cursor += slice;
		assignSectors(child, demand);
	}
}

// The required gap between two clusters isn't one flat number — a cluster
// with 40 files needs a much bigger clearing (to fit that many portal arches
// without them overlapping) than one with 2. This mirrors the engine's
// clearing size (weight here is file count, what WorldScene calls
// cluster.portalIds.length) — deliberately duplicated rather than imported:
// converter has no other reason to depend on the engine package.
//
// 2026-09-28 (round 2): a clearing also has to leave a gap in its arch ring
// for every path that leaves it (the engine's systems/portalRing.ts keeps
// arches off path ribbons), so its ring radius depends on the cluster's path
// count ("degree": its children plus the path in from its parent) as well as
// its file count. This is portalRing.ts's portalRingBaseRadius(), duplicated
// for the reason above; the engine may still grow a ring past it when a
// cluster's actual paths bunch up on one side.
const ARCH_SLOT_PX = 192; // PORTAL_ARCH_FRAME_SIZE (256) * WORLD_PORTAL_SCALE (0.75), render/scale.ts
const PATH_GATE_PX = 96;
const PORTAL_RING_MIN_RADIUS_PX = 180;
const CLEARING_OUTER_MARGIN_PX = 90;
export const CLEARING_GAP_PX = 60; // visible gap between two clearings' *edges*, not just their centers
// The engine's systems/heroPortal.ts HERO_ROOT_MIN_RING_RADIUS_PX: a hero
// site arch stands 192px from the bonfire, so the root's ring keeps one arch
// slot (192px) beyond it.
export const HERO_ROOT_MIN_RING_RADIUS_PX = 384;

export function portalRingBaseRadius(
	portalCount: number,
	pathCount: number,
): number {
	if (portalCount <= 0) return PORTAL_RING_MIN_RADIUS_PX;
	const circumference =
		pathCount <= 0
			? portalCount * ARCH_SLOT_PX
			: pathCount *
				(Math.ceil(portalCount / pathCount) * ARCH_SLOT_PX + PATH_GATE_PX);
	return Math.max(PORTAL_RING_MIN_RADIUS_PX, circumference / (Math.PI * 2));
}

// This is the clearing ellipse's half-WIDTH. Since 2026-09-29 the engine
// grows the half-height past it until the arches fit (clearingFit.ts), by at
// most CLEARING_HEIGHT_OVERSHOOT_PX. Positions stay spaced by the width
// alone, here and in shadowLayout.ts, so no cluster moved; two overshoots
// still fit inside CLEARING_GAP_PX (clearingFit.test.ts checks both).
export const CLEARING_HEIGHT_OVERSHOOT_PX = 18;

export function estimatedClearingRadius(
	portalCount: number,
	pathCount: number,
): number {
	return (
		portalRingBaseRadius(portalCount, pathCount) + CLEARING_OUTER_MARGIN_PX
	);
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
	requiredGap: Map<string, number>,
	rootId: string,
): void {
	const ids = [...out.keys()].sort();

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

/** Pure: identical tree in -> identical positions out, every time. */
export function computeLayout(
	root: LayoutTreeNode,
): Map<string, LayoutPosition> {
	const infos: NodeInfo[] = [];
	const rootInfo = collectInfo(root, 0, undefined, infos);
	const infoOf = new Map(infos.map((i) => [i.node, i]));
	const { radiusOf: solved, demand } = solveRadii(rootInfo, infos);
	rootInfo.sectorStart = 0;
	rootInfo.sectorEnd = Math.PI * 2;
	assignSectors(rootInfo, demand);
	const radiusOf = tighten(rootInfo, solved);

	const out = new Map<string, LayoutPosition>();
	const requiredGap = new Map<string, number>();
	// Preorder (root first, children in input order) so Map iteration order
	// matches the old recursive placement — the snapshot records it.
	const visit = (node: LayoutTreeNode): void => {
		const info = infoOf.get(node);
		if (!info) return;
		requiredGap.set(node.id, info.clearingRadius);
		if (info.depth === 0) {
			out.set(node.id, { x: 0, y: 0 });
		} else {
			const radius = radiusOf.get(info) ?? info.depth * RING_RADIUS_PER_DEPTH;
			// Math.cos/Math.sin determinism is scoped to a single JS engine: V8
			// gives byte-identical output run to run (what our snapshot/byte-
			// stability tests rely on), but a different engine's last-ulp trig
			// rounding could disagree. Not a concern until worlds are compared
			// or hashed across engines.
			const j = jitter(node.id);
			const angle = (info.sectorStart + info.sectorEnd) / 2;
			out.set(node.id, {
				x: Math.cos(angle) * radius + j.x,
				y: Math.sin(angle) * radius + j.y,
			});
		}
		for (const child of node.children) visit(child);
	};
	visit(root);
	enforceMinimumSeparation(out, requiredGap, root.id);
	return out;
}
