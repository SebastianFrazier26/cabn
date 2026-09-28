import { hashNoise2D } from "../systems/deterministicRandom.js";

export interface StampPoint {
	x: number;
	y: number;
	/** Segment direction in radians — the stamp sprite is rotated to this so an elongated stamp variant lines up with the path instead of always facing one way. */
	angle: number;
}

export interface StampOptions {
	/** Perpendicular jitter magnitude in px — 0 lays stamps dead-center on the line; a little wobble reads as a worn dirt track rather than a ruler-straight line. */
	jitterAmount?: number;
	jitterSeed?: number;
}

/**
 * Points spaced roughly `spacing` px apart along a straight segment, for
 * stamping soft dirt-brush sprites along an arbitrary-angle path (chosen over
 * corner/T/cross path *tiles* — see gen-world-art.ts's path-stamp module doc
 * comment for why — so this has no notion of a tile grid at all, just
 * distance along the line). Spacing is adjusted down slightly so stamps land
 * exactly on both endpoints (`length / round(length / spacing)`), rather than
 * leaving a short leftover gap at the far end.
 */
export function stampPointsAlongSegment(
	from: { x: number; y: number },
	to: { x: number; y: number },
	spacing: number,
	opts: StampOptions = {},
): StampPoint[] {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	const angle = Math.atan2(dy, dx);
	if (length === 0) return [{ x: from.x, y: from.y, angle: 0 }];

	const count = Math.max(1, Math.round(length / spacing));
	const actualSpacing = length / count;
	const jitterAmount = opts.jitterAmount ?? 0;
	const seed = opts.jitterSeed ?? 0;
	const perpAngle = angle + Math.PI / 2;

	const points: StampPoint[] = [];
	for (let i = 0; i <= count; i++) {
		const d = i * actualSpacing;
		let x = from.x + Math.cos(angle) * d;
		let y = from.y + Math.sin(angle) * d;
		if (jitterAmount > 0) {
			const j = (hashNoise2D(i, 0, seed) * 2 - 1) * jitterAmount;
			x += Math.cos(perpAngle) * j;
			y += Math.sin(perpAngle) * j;
		}
		points.push({ x, y, angle });
	}
	return points;
}
