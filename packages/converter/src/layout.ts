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
// 2026-09-28: back up to 600 with the 2x world portal arches — a weight-1
// clearing's estimatedClearingRadius() is now 270px, so a parent/child pair
// needs 600px (2x270 + CLEARING_GAP_PX) and a 450px ring had separateClusters()
// shoving every depth-1 cluster off its ring. Walks are ~33% longer in px,
// but everything along them is drawn 2x larger, so they read about the same.
// Round 2 (same day): now only the minimum step — ringRadii() widens a ring
// when its clusters need more room, instead of separation shoving them.
const RING_RADIUS_PER_DEPTH = 600;
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

interface NodeInfo {
	node: LayoutTreeNode;
	depth: number;
	clearingRadius: number;
	/** Arc length (px) this node's subtree needs on the rings below it — see assignAngles. */
	wedge: number;
	angle: number;
}

function collectInfo(
	node: LayoutTreeNode,
	depth: number,
	hasParent: boolean,
	out: NodeInfo[],
): NodeInfo {
	const children = node.children.map((child) =>
		collectInfo(child, depth + 1, true, out),
	);
	const clearingRadius = estimatedClearingRadius(
		Math.max(node.weight, 0),
		node.children.length + (hasParent ? 1 : 0),
	);
	const info: NodeInfo = {
		node,
		depth,
		clearingRadius,
		wedge: Math.max(
			clearingRadius * 2 + CLEARING_GAP_PX,
			children.reduce((sum, c) => sum + c.wedge, 0),
		),
		angle: 0,
	};
	out.push(info);
	return info;
}

// 2026-09-28 playtest round 2 ("portals are still spaced kind of weirdly"):
// slices used to be proportional to raw file count, so a one-file directory
// got a sliver next to a busy sibling and enforceMinimumSeparation() then
// shoved the crowded ones outward along arbitrary axes — the demo's depth-1
// clusters ended up at gaps anywhere from 16deg to 66deg and radii from 600
// to 1150px, with one cluster pushed straight behind another so its path ran
// through the nearer clearing's arches. Slicing by the arc each subtree
// actually needs (its own clearing, or its children's, whichever is wider)
// gives equal-footprint siblings equal angles.
function assignAngles(
	info: NodeInfo,
	infoOf: Map<LayoutTreeNode, NodeInfo>,
	angleStart: number,
	angleEnd: number,
): void {
	info.angle = (angleStart + angleEnd) / 2;
	const children = info.node.children
		.map((c) => infoOf.get(c))
		.filter((c): c is NodeInfo => c !== undefined);
	const total = children.reduce((sum, c) => sum + c.wedge, 0);
	let cursor = angleStart;
	for (const child of children) {
		const slice = (child.wedge / total) * (angleEnd - angleStart);
		assignAngles(child, infoOf, cursor, cursor + slice);
		cursor += slice;
	}
}

/**
 * Each depth's ring is pushed out just far enough that (a) every node clears
 * every node one ring in (radial gap >= both rings' biggest clearings + the
 * gap) and (b) angularly adjacent nodes on the same ring — cousins included —
 * clear each other along the chord. RING_RADIUS_PER_DEPTH stays the minimum
 * step, so a sparse world keeps its old 600/1200/... rings.
 */
function ringRadii(infos: NodeInfo[]): number[] {
	const byDepth: NodeInfo[][] = [];
	for (const info of infos) {
		const ring = byDepth[info.depth] ?? [];
		ring.push(info);
		byDepth[info.depth] = ring;
	}
	const radii = [0];
	const maxClearing = (depth: number) =>
		Math.max(0, ...(byDepth[depth] ?? []).map((i) => i.clearingRadius));
	for (let depth = 1; depth < byDepth.length; depth++) {
		const prev = radii[depth - 1] ?? 0;
		let radius = Math.max(
			prev + RING_RADIUS_PER_DEPTH,
			prev + maxClearing(depth - 1) + maxClearing(depth) + CLEARING_GAP_PX,
		);
		const ring = [...(byDepth[depth] ?? [])].sort((a, b) => a.angle - b.angle);
		if (ring.length > 1) {
			for (let i = 0; i < ring.length; i++) {
				const a = ring[i];
				const b = ring[(i + 1) % ring.length];
				if (!a || !b) continue;
				let delta = b.angle - a.angle;
				if (delta <= 0) delta += Math.PI * 2;
				const half = Math.min(delta, Math.PI) / 2;
				const need = a.clearingRadius + b.clearingRadius + CLEARING_GAP_PX;
				radius = Math.max(radius, need / (2 * Math.sin(half)));
			}
		}
		radii.push(radius);
	}
	return radii;
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
	const rootInfo = collectInfo(root, 0, false, infos);
	const infoOf = new Map(infos.map((i) => [i.node, i]));
	assignAngles(rootInfo, infoOf, 0, Math.PI * 2);
	const radii = ringRadii(infos);

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
			const radius = radii[info.depth] ?? info.depth * RING_RADIUS_PER_DEPTH;
			// Math.cos/Math.sin determinism is scoped to a single JS engine: V8
			// gives byte-identical output run to run (what our snapshot/byte-
			// stability tests rely on), but a different engine's last-ulp trig
			// rounding could disagree. Not a concern until worlds are compared
			// or hashed across engines.
			const j = jitter(node.id);
			out.set(node.id, {
				x: Math.cos(info.angle) * radius + j.x,
				y: Math.sin(info.angle) * radius + j.y,
			});
		}
		for (const child of node.children) visit(child);
	};
	visit(root);
	enforceMinimumSeparation(out, requiredGap, root.id);
	return out;
}
