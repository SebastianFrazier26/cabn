const TAU = Math.PI * 2;

function normalizeAngle(angle: number): number {
	return ((angle % TAU) + TAU) % TAU;
}

/**
 * The angle (radians) at the middle of the largest gap between a set of
 * angles arranged around a circle — used to place the shelf's one-off castle
 * accent somewhere it won't sit on top of a cabin or the path leading to it,
 * generalizing past "just point it southwest" to however many cabins a
 * shelf actually has. Returns 0 for an empty input (nothing to avoid).
 */
export function largestAngularGapMidpoint(
	anglesRad: readonly number[],
): number {
	if (anglesRad.length === 0) return 0;

	const sorted = [...anglesRad].map(normalizeAngle).sort((a, b) => a - b);
	let bestGapStart = sorted[0] ?? 0;
	let bestGapSize = -1;

	for (let i = 0; i < sorted.length; i++) {
		const start = sorted[i];
		if (start === undefined) continue;
		const next =
			i + 1 < sorted.length ? (sorted[i + 1] ?? 0) : (sorted[0] ?? 0) + TAU;
		const gapSize = next - start;
		if (gapSize > bestGapSize) {
			bestGapSize = gapSize;
			bestGapStart = start;
		}
	}

	return normalizeAngle(bestGapStart + bestGapSize / 2);
}
