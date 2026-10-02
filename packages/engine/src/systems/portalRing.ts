const TAU = Math.PI * 2;

export interface PortalRingSizes {
	/** Arc length one arch claims on the ring (its display width plus air). */
	archSlotPx: number;
	/** Extra arc length reserved around every path leaving the hub, so a path ribbon runs between two arches instead of under one. */
	pathGatePx: number;
	minRadiusPx: number;
}

export interface PortalRing {
	radius: number;
	/** One angle per portal, in portal order: clockwise from the top. */
	angles: number[];
}

const MAX_GROW_STEPS = 80;
const GROW_FACTOR = 1.06;

function normalize(angle: number): number {
	return ((angle % TAU) + TAU) % TAU;
}

/**
 * The ring radius a cluster with `portalCount` arches and `pathCount` paths
 * needs when those paths are spread evenly around it: every path takes a
 * gate, and the arches between two paths share that arc. Mirrored
 * (deliberately duplicated) in packages/converter/src/layout.ts, which sizes
 * whole clearings with it before any path angle exists.
 */
export function portalRingBaseRadius(
	portalCount: number,
	pathCount: number,
	sizes: PortalRingSizes,
): number {
	if (portalCount <= 0) return sizes.minRadiusPx;
	const circumference =
		pathCount <= 0
			? portalCount * sizes.archSlotPx
			: pathCount *
				(Math.ceil(portalCount / pathCount) * sizes.archSlotPx +
					sizes.pathGatePx);
	return Math.max(sizes.minRadiusPx, circumference / TAU);
}

function clockwiseFromTop(angles: number[]): number[] {
	return angles
		.map(normalize)
		.sort((a, b) => normalize(a + Math.PI / 2) - normalize(b + Math.PI / 2));
}

/** Evenly spaced arches rotated into the middle of the widest gap the paths leave (all paths folded into one arch period); null if that still lands an arch inside a path's gate. */
function evenRing(
	count: number,
	paths: number[],
	radius: number,
	sizes: PortalRingSizes,
): number[] | null {
	const period = TAU / count;
	if (period * radius < sizes.archSlotPx) return null;
	const folded = paths.map((a) => a % period).sort((a, b) => a - b);
	let bestStart = 0;
	let bestGap = -1;
	for (let i = 0; i < folded.length; i++) {
		const start = folded[i] ?? 0;
		const next =
			i + 1 < folded.length ? (folded[i + 1] ?? 0) : (folded[0] ?? 0) + period;
		if (next - start > bestGap) {
			bestGap = next - start;
			bestStart = start;
		}
	}
	const clearance = (bestGap / 2) * radius;
	if (clearance < (sizes.archSlotPx + sizes.pathGatePx) / 2) return null;
	const offset = bestStart + bestGap / 2;
	return Array.from({ length: count }, (_, i) => offset + i * period);
}

/** Arches shared out between the arcs the paths cut the ring into (largest remainder, by usable arc length), evenly spaced within each arc; null if the arcs can't hold them all at this radius. */
function gatedRing(
	count: number,
	paths: number[],
	radius: number,
	sizes: PortalRingSizes,
): number[] | null {
	const gate = sizes.pathGatePx / radius;
	const arcs = paths.map((start, i) => {
		const end =
			i + 1 < paths.length ? (paths[i + 1] ?? 0) : (paths[0] ?? 0) + TAU;
		const usablePx = Math.max(0, (end - start) * radius - sizes.pathGatePx);
		return {
			start: start + gate / 2,
			span: Math.max(0, end - start - gate),
			usablePx,
			capacity: Math.floor(usablePx / sizes.archSlotPx),
			assigned: 0,
		};
	});
	const capacity = arcs.reduce((sum, a) => sum + a.capacity, 0);
	if (capacity < count) return null;

	const totalUsable = arcs.reduce((sum, a) => sum + a.usablePx, 0);
	const ideal = arcs.map((a) => (count * a.usablePx) / totalUsable);
	arcs.forEach((a, i) => {
		a.assigned = Math.min(a.capacity, Math.floor(ideal[i] ?? 0));
	});
	let left = count - arcs.reduce((sum, a) => sum + a.assigned, 0);
	while (left > 0) {
		let pick = -1;
		let bestRemainder = Number.NEGATIVE_INFINITY;
		arcs.forEach((a, i) => {
			if (a.assigned >= a.capacity) return;
			const remainder = (ideal[i] ?? 0) - a.assigned;
			if (remainder > bestRemainder) {
				bestRemainder = remainder;
				pick = i;
			}
		});
		const arc = arcs[pick];
		if (!arc) return null;
		arc.assigned++;
		left--;
	}
	return arcs.flatMap((a) =>
		Array.from(
			{ length: a.assigned },
			(_, j) => a.start + (a.span * (j + 0.5)) / a.assigned,
		),
	);
}

/**
 * Where a cluster's portal arches go on the ring around its hub. With no
 * paths this is the old layout — evenly spaced, clockwise from the top. With
 * paths, no arch may sit on a path ribbon (2026-09-28 playtest round 2: a
 * one-file cluster's lone arch always sat at the top, so a path arriving from
 * above ended at the arch and read as "linked to just a portal"; the root's
 * arches sat across its outgoing paths). The ring stays evenly spaced when a
 * rotation of it clears every path's gate, otherwise the arches split
 * between the arcs between paths — and if the arcs are too short to hold
 * them all (paths bunched up on one side), the radius grows until they fit.
 * Pure and deterministic: same inputs, same ring.
 */
export function layoutPortalRing(
	portalCount: number,
	pathAnglesRad: readonly number[],
	sizes: PortalRingSizes,
): PortalRing {
	const paths = [...new Set(pathAnglesRad.map(normalize))].sort(
		(a, b) => a - b,
	);
	let radius = portalRingBaseRadius(portalCount, paths.length, sizes);
	if (portalCount <= 0) return { radius, angles: [] };
	if (paths.length === 0) {
		return {
			radius,
			angles: Array.from(
				{ length: portalCount },
				(_, i) => (TAU * i) / portalCount - Math.PI / 2,
			),
		};
	}
	for (let step = 0; step < MAX_GROW_STEPS; step++) {
		const angles =
			evenRing(portalCount, paths, radius, sizes) ??
			gatedRing(portalCount, paths, radius, sizes);
		if (angles) return { radius, angles: clockwiseFromTop(angles) };
		radius *= GROW_FACTOR;
	}
	// Unreachable for any real cluster (80 steps is ~100x the base radius);
	// falls back to the path-blind ring rather than looping forever.
	return {
		radius,
		angles: Array.from(
			{ length: portalCount },
			(_, i) => (TAU * i) / portalCount - Math.PI / 2,
		),
	};
}
