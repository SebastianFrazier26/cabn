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
}

/**
 * Deterministically scatters decal points inside a cluster's ground ellipse,
 * never inside an exclusion circle (portals/spawn/paths) and never closer to
 * each other than `minSpacing`. Uniform-in-ellipse sampling (polar with a
 * sqrt-scaled radius, the standard trick for uniform-disk sampling) rather
 * than a jittered grid — a grid would visibly align decals into rows at any
 * tile-sized spacing, which reads as planted, not naturally scattered.
 */
export function placeScatter(opts: ScatterOptions): ScatterPoint[] {
	const rand = mulberry32(hashStringSeed(opts.clusterId));
	const maxAttempts = opts.maxAttemptsPerPoint ?? 20;
	const points: ScatterPoint[] = [];

	for (let i = 0; i < opts.count; i++) {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const angle = rand() * Math.PI * 2;
			const r = Math.sqrt(rand());
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
