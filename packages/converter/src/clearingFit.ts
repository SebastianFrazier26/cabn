// A clearing's ground is an ellipse: radiusX comes from its portal ring
// (ring radius + outer margin), radiusY was always a flat 0.65 of it. Arches
// sit on a circle, so the top and bottom ones poked out of that ellipse
// (2026-09-29 playtest). The user's call: keep radiusX and every cluster
// position as they are, and grow only radiusY, only as far as the ring
// needs. Lives in the converter so both sides share one formula: the engine
// (WorldScene) sizes each clearing from its actual ring, and the converter's
// layout.ts bounds how far past the half-width any ring can push the height
// (CLEARING_HEIGHT_OVERSHOOT_PX).

export interface FootprintPoint {
	x: number;
	y: number;
}

export const GROUND_RADIUS_Y_RATIO = 0.65;

// The 2x world arch is a 256px frame at WORLD_PORTAL_SCALE 0.75, +-96px
// around its centre. Measured from the alpha of portal_arch_strip_soft.png
// and portal_arch_variants_soft.png (2026-09-29): a variant's roof finial
// reaches frame row 0 and the pillars stand on row 255, so the arch spans
// the full 192px vertically.
//
// Only that vertical extent, at the arch's centre column, is fitted — not
// the pillars' full 146px width. With radiusX fixed at ring + 90, an arch
// near the side of the ring has its outer pillar at ring + 73, where the
// ellipse is only a sliver tall; containing that corner by height alone
// needs radiusY of ring + ~190, which turns every clearing into a tall oval
// that overlaps its neighbours (up to 110px in the sample world). Measured
// this way, the top and bottom arches (the reported bug) still sit fully
// inside, pillars included; see test/clearingFit.test.ts.
export const WORLD_ARCH_FOOTPRINT: readonly FootprintPoint[] = [
	{ x: 0, y: -96 },
	{ x: 0, y: 96 },
];

/** Grass kept between an arch's roof/base and the clearing's edge, measured vertically: radiusX is fixed. */
export const CLEARING_FIT_MARGIN_PX = 12;

/**
 * The half-height a clearing needs so every arch on its ring (ring centred on
 * the clearing, `angles` in radians) lies inside the ellipse — never less
 * than today's GROUND_RADIUS_Y_RATIO * radiusX. For a footprint point at
 * (x, y) the ellipse test (x/rx)^2 + ((|y|+margin)/ry)^2 <= 1 solves to
 * ry >= (|y|+margin) / sqrt(1 - (x/rx)^2).
 */
export function clearingRadiusYForRing(
	ringRadius: number,
	angles: readonly number[],
	radiusX: number,
	footprint: readonly FootprintPoint[] = WORLD_ARCH_FOOTPRINT,
	marginPx: number = CLEARING_FIT_MARGIN_PX,
): number {
	let radiusY = radiusX * GROUND_RADIUS_Y_RATIO;
	for (const angle of angles) {
		const cx = Math.cos(angle) * ringRadius;
		const cy = Math.sin(angle) * ringRadius;
		for (const p of footprint) {
			const x = Math.abs(cx + p.x);
			const y = Math.abs(cy + p.y) + marginPx;
			const room = 1 - (x / radiusX) ** 2;
			if (room <= 0)
				throw new Error(
					`clearingFit: arch reaches x=${x.toFixed(1)} past radiusX=${radiusX}; no height can contain it`,
				);
			radiusY = Math.max(radiusY, y / Math.sqrt(room));
		}
	}
	return radiusY;
}

// Fine enough that the sampled maximum sits within a fraction of a pixel of
// the true one for any ring the layout produces (radius < ~5000px).
const WORST_CASE_SAMPLES = 1440;

/** clearingRadiusYForRing for an arch at any angle — what a clearing can grow to before its actual ring (which depends on path angles) is known. */
export function worstCaseClearingRadiusY(
	ringRadius: number,
	radiusX: number,
	footprint: readonly FootprintPoint[] = WORLD_ARCH_FOOTPRINT,
	marginPx: number = CLEARING_FIT_MARGIN_PX,
): number {
	const angles = Array.from(
		{ length: WORST_CASE_SAMPLES },
		(_, i) => (Math.PI * 2 * i) / WORST_CASE_SAMPLES,
	);
	return clearingRadiusYForRing(
		ringRadius,
		angles,
		radiusX,
		footprint,
		marginPx,
	);
}
