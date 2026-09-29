import {
	CLEARING_GAP_PX,
	estimatedClearingRadius,
	type LayoutPosition,
} from "./layout.js";

/**
 * Second placement pass for the shadow realm's clusters. The base world is
 * already laid out and is never touched: every base position stays
 * byte-identical, and new clearings are fitted into the space around it one
 * at a time. computeLayout's ring layout can't be reused — re-running it
 * with the extra nodes would move base clusters.
 */

export interface ShadowPlacementNode {
	id: string;
	/** A base cluster or an earlier node in the list. */
	parentId: string;
	portalCount: number;
}

export interface ShadowPlacementBase {
	clusters: readonly {
		id: string;
		pos: LayoutPosition;
		portalIds: readonly string[];
	}[];
	paths: readonly { from: string; to: string }[];
}

const DISTANCE_STEP_PX = 60;
const ANGLE_CANDIDATES = 72;
const MAX_DISTANCE_STEPS = 200;
const TWO_PI = Math.PI * 2;

interface Placed {
	id: string;
	x: number;
	y: number;
	r: number;
}

function normalize(angle: number): number {
	const a = angle % TWO_PI;
	return a < 0 ? a + TWO_PI : a;
}

function angularDistance(a: number, b: number): number {
	const d = Math.abs(normalize(a) - normalize(b));
	return Math.min(d, TWO_PI - d);
}

function distanceToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t =
		len2 === 0
			? 0
			: Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Rounded so a snapshot doesn't hinge on the last ulp of Math.cos/sin.
function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * The 72 candidate directions around `parent`, best first: directions inside
 * the widest free gap between the paths already leaving the parent come
 * first; within one gap, those closest to "away from the root" (or the gap's
 * middle, when away-from-root isn't inside it) win; index breaks exact ties.
 */
function orderedAngles(
	parent: Placed,
	neighbors: readonly Placed[],
	root: Placed,
): number[] {
	const occupied = neighbors
		.map((n) => normalize(Math.atan2(n.y - parent.y, n.x - parent.x)))
		.sort((a, b) => a - b);
	const away =
		parent.id === root.id
			? undefined
			: normalize(Math.atan2(parent.y - root.y, parent.x - root.x));

	const gapOf = (angle: number): { size: number; start: number } => {
		if (occupied.length === 0) return { size: TWO_PI, start: 0 };
		for (let i = 0; i < occupied.length; i++) {
			const start = occupied[i] ?? 0;
			const end =
				i + 1 < occupied.length
					? (occupied[i + 1] ?? 0)
					: (occupied[0] ?? 0) + TWO_PI;
			const a = angle < start ? angle + TWO_PI : angle;
			if (a >= start && a < end) return { size: end - start, start };
		}
		return { size: 0, start: 0 };
	};

	const scored = Array.from({ length: ANGLE_CANDIDATES }, (_, k) => {
		const angle = (k * TWO_PI) / ANGLE_CANDIDATES;
		const gap = gapOf(angle);
		let target: number;
		if (occupied.length === 0) target = away ?? 0;
		else {
			target =
				away !== undefined && normalize(away - gap.start) < gap.size
					? away
					: gap.start + gap.size / 2;
		}
		return {
			k,
			angle,
			gap: Math.round(gap.size * 1e6),
			off: Math.round(angularDistance(angle, target) * 1e6),
		};
	});
	scored.sort((a, b) => b.gap - a.gap || a.off - b.off || a.k - b.k);
	return scored.map((s) => s.angle);
}

export function placeShadowClusters(
	base: ShadowPlacementBase,
	nodes: readonly ShadowPlacementNode[],
): Map<string, LayoutPosition> {
	const childCount = new Map<string, number>();
	for (const n of nodes)
		childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
	const baseDegree = new Map<string, number>();
	for (const p of base.paths) {
		baseDegree.set(p.from, (baseDegree.get(p.from) ?? 0) + 1);
		baseDegree.set(p.to, (baseDegree.get(p.to) ?? 0) + 1);
	}

	const placed = new Map<string, Placed>();
	const neighbors = new Map<string, string[]>();
	const link = (a: string, b: string) => {
		neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
		neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
	};
	// Base clearings are sized with the shadow paths they will gain too, so a
	// clearing the engine grows to fit its extra path gates still clears.
	for (const c of base.clusters) {
		placed.set(c.id, {
			id: c.id,
			x: c.pos.x,
			y: c.pos.y,
			r: estimatedClearingRadius(
				c.portalIds.length,
				(baseDegree.get(c.id) ?? 0) + (childCount.get(c.id) ?? 0),
			),
		});
	}
	for (const p of base.paths) link(p.from, p.to);
	const root = base.clusters[0] ? placed.get(base.clusters[0].id) : undefined;

	const out = new Map<string, LayoutPosition>();
	for (const node of nodes) {
		const parent = placed.get(node.parentId);
		if (!parent || !root)
			throw new Error(`shadow layout: unknown parent "${node.parentId}"`);
		if (placed.has(node.id))
			throw new Error(`shadow layout: duplicate id "${node.id}"`);
		const r = estimatedClearingRadius(
			node.portalCount,
			1 + (childCount.get(node.id) ?? 0),
		);
		const others = [...placed.values()];
		const angles = orderedAngles(
			parent,
			(neighbors.get(parent.id) ?? [])
				.map((id) => placed.get(id))
				.filter((p): p is Placed => p !== undefined),
			root,
		);
		/** -1: overlaps a clearing; otherwise how many clearings the path from the parent crosses. */
		const crossings = (x: number, y: number): number => {
			let crossed = 0;
			for (const q of others) {
				if (Math.hypot(x - q.x, y - q.y) < r + q.r + CLEARING_GAP_PX) return -1;
				if (
					q.id !== parent.id &&
					distanceToSegment(q.x, q.y, parent.x, parent.y, x, y) < q.r
				)
					crossed++;
			}
			return crossed;
		};

		let pos: LayoutPosition | undefined;
		// A parent with many shadow children can run out of clear directions
		// entirely (every ray already passes some clearing): then the
		// overlap-free spot whose path crosses the fewest clearings wins.
		let fallback: { pos: LayoutPosition; crossed: number } | undefined;
		const start = parent.r + r + CLEARING_GAP_PX;
		search: for (let step = 0; step < MAX_DISTANCE_STEPS; step++) {
			const d = start + step * DISTANCE_STEP_PX;
			for (const angle of angles) {
				const x = round2(parent.x + Math.cos(angle) * d);
				const y = round2(parent.y + Math.sin(angle) * d);
				const crossed = crossings(x, y);
				if (crossed === 0) {
					pos = { x, y };
					break search;
				}
				if (crossed > 0 && (!fallback || crossed < fallback.crossed))
					fallback = { pos: { x, y }, crossed };
			}
		}
		pos ??= fallback?.pos;
		if (!pos) {
			// Hemmed in on every side: past the outermost clearing nothing can
			// overlap, at the cost of a path that may cross another clearing.
			const reach = Math.max(
				...others.map((q) => Math.hypot(q.x - parent.x, q.y - parent.y) + q.r),
			);
			const angle = angles[0] ?? 0;
			const d = reach + r + CLEARING_GAP_PX;
			pos = {
				x: round2(parent.x + Math.cos(angle) * d),
				y: round2(parent.y + Math.sin(angle) * d),
			};
		}
		placed.set(node.id, { id: node.id, x: pos.x, y: pos.y, r });
		link(parent.id, node.id);
		out.set(node.id, pos);
	}
	return out;
}
