/**
 * Shared 4-tone "cel shading" bands for the v3 item icons — a fixed
 * up-left light source (same direction every icon uses, so the set reads
 * as one consistent material study rather than five independently-lit
 * objects), quantized into 4 bands: 0 = deepest shadow, 3 = brightest
 * highlight. Each icon maps these indices onto its own legend chars/colors.
 */
export type ShadeBand = 0 | 1 | 2 | 3;

/**
 * For roughly cylindrical forms (rods, tubes, barrels): `signedPerp` is the
 * signed distance from the shape's centerline, `radius` the local half-width
 * at that point. Negative perp (the light's side, up-left along the tube)
 * comes out brighter.
 */
export function cylinderBand(signedPerp: number, radius: number): ShadeBand {
	const t = radius > 0 ? signedPerp / radius : 0;
	if (t < -0.45) return 3;
	if (t < 0.05) return 2;
	if (t < 0.55) return 1;
	return 0;
}

/**
 * For roughly spherical/round forms: `dot` is the dot product of the
 * surface point's outward normal (dx/r, dy/r) with the fixed light
 * direction (-0.55, -0.75, up-and-left) — precompute as
 * `(dx / r) * -0.55 + (dy / r) * -0.75`.
 */
export function sphereBand(dot: number): ShadeBand {
	if (dot > 0.55) return 3;
	if (dot > 0.1) return 2;
	if (dot > -0.35) return 1;
	return 0;
}

export const LIGHT_DIR = { x: -0.55, y: -0.75 } as const;
