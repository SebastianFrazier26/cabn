import { hashStringSeed, mulberry32 } from "./deterministicRandom.js";

export interface ScatterExclusion {
	x: number;
	y: number;
	/** No scatter point may land within this radius — portals, spawn points, path corridors. */
	radius: number;
}

export interface ScatterPoint {
	x: number;
	y: number;
	/** Index into the caller's decal-variant list — which sprite to draw here. */
	variant: number;
}

export interface ScatterOptions {
	/** Seeds the placement — same cluster always scatters the same way, across reloads and rebuilds. */
	clusterId: string;
	centerX: number;
	centerY: number;
	radiusX: number;
	radiusY: number;
	/** How many decals to try to place — the actual count can be lower if exclusions/spacing leave no room. */
	count: number;
	minSpacing: number;
	variantCount: number;
	exclusions: readonly ScatterExclusion[];
	/** Rejection-sample attempts per point before giving up on that one and moving to the next — bounds worst-case cost on a densely excluded cluster. */
	maxAttemptsPerPoint?: number;
	/**
	 * Restricts sampling to the outer annulus [minRadiusFrac, 1] of the
	 * ellipse instead of the whole disk — 0 (the default) is the old
	 * whole-disk behavior. M10b batch-3 review: "props should frame clearings
	 * (edges, corners)", not scatter anywhere non-excluded — a plain
	 * exclusion circle around the center stops a prop from sitting *on* the
	 * plaza, but says nothing about where in the remaining disk it lands, so
	 * props could still cluster awkwardly close to the middle rather than
	 * reading as framing the edge.
	 */
	minRadiusFrac?: number;
}

/**
 * Deterministically scatters decal points inside a cluster's ground ellipse
 * (or an outer annulus of it — see minRadiusFrac), never inside an exclusion
 * circle (portals/spawn/paths) and never closer to each other than
 * `minSpacing`. Uniform-in-area sampling (polar with a sqrt-scaled radius,
 * the standard trick for uniform-disk sampling, generalized to an annulus by
 * offsetting that radius by minRadiusFrac's own squared contribution) rather
 * than a jittered grid — a grid would visibly align decals into rows at any
 * tile-sized spacing, which reads as planted, not naturally scattered.
 */
export function placeScatter(opts: ScatterOptions): ScatterPoint[] {
	const rand = mulberry32(hashStringSeed(opts.clusterId));
	const maxAttempts = opts.maxAttemptsPerPoint ?? 20;
	const points: ScatterPoint[] = [];
	const innerFracSq = (opts.minRadiusFrac ?? 0) ** 2;

	for (let i = 0; i < opts.count; i++) {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const angle = rand() * Math.PI * 2;
			const r = Math.sqrt(innerFracSq + rand() * (1 - innerFracSq));
			const x = opts.centerX + Math.cos(angle) * r * opts.radiusX;
			const y = opts.centerY + Math.sin(angle) * r * opts.radiusY;

			if (
				opts.exclusions.some((e) => Math.hypot(x - e.x, y - e.y) < e.radius)
			) {
				continue;
			}
			if (points.some((p) => Math.hypot(x - p.x, y - p.y) < opts.minSpacing)) {
				continue;
			}

			points.push({ x, y, variant: Math.floor(rand() * opts.variantCount) });
			break;
		}
	}

	return points;
}
