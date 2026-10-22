import { largestAngularGapMidpoint } from "./angularGap.js";

/**
 * The hero site portal (cabn.json `sites[].hero`) stands inside the root
 * clearing, between the spawn bonfire and the arch ring, rather than on the
 * ring: a busy root's ring can be hundreds of pixels out, and the hero is
 * meant to be the first thing a visitor sees. The default spawn point sits on
 * the same line, so a fresh visit starts this far from the arch — inside
 * PORTAL_APPROACH_RADIUS (150), where its live page appears in the opening,
 * and just outside PORTAL_FOCUS_RADIUS (100), so one step toward it docks the
 * page at a readable size without the dock covering the world on arrival.
 */
export const HERO_SPAWN_GAP_PX = 112;

/**
 * Hub-to-hero distance: the bonfire's half-width (80px at BONFIRE_SCALE) plus
 * the spawn's clearance (24px) plus HERO_SPAWN_GAP_PX. Mirrored in
 * packages/converter/src/layout.ts (HERO_ROOT_MIN_RING_RADIUS_PX), which sizes
 * the root clearing for it.
 */
export const HERO_HUB_DISTANCE_PX = 176;

/** The root's arch ring must clear the hero arch: hub distance plus one arch slot (192px). */
export const HERO_ROOT_MIN_RING_RADIUS_PX = HERO_HUB_DISTANCE_PX + 192;

/** Glow behind the hero arch: a larger, gold, additive copy of the arch itself (no new art). */
export const HERO_GLOW_SCALE = 1.14;
export const HERO_GLOW_ALPHA_MIN = 0.22;
export const HERO_GLOW_ALPHA_MAX = 0.5;
export const HERO_GLOW_PULSE_MS = 1400;

export interface Point {
	x: number;
	y: number;
}

/**
 * Which way the hero stands from the hub: due east (where a fresh spawn has
 * always been) when no path leaves the root, otherwise the middle of the
 * widest gap between the root's paths, so no path ribbon runs under it.
 */
export function heroAngle(pathAnglesRad: readonly number[]): number {
	if (pathAnglesRad.length === 0) return 0;
	return largestAngularGapMidpoint(pathAnglesRad);
}

export function heroPosition(hub: Point, angle: number): Point {
	return {
		x: hub.x + Math.cos(angle) * HERO_HUB_DISTANCE_PX,
		y: hub.y + Math.sin(angle) * HERO_HUB_DISTANCE_PX,
	};
}

/** A fresh spawn beside the bonfire, on the hub-to-hero line (the old spawn was the same offset due east). */
export function heroSpawnPosition(
	hub: Point,
	angle: number,
	offsetPx: number,
): Point {
	return {
		x: hub.x + Math.cos(angle) * offsetPx,
		y: hub.y + Math.sin(angle) * offsetPx,
	};
}

/** The hero portal id, if the showcase names one that really is in the root cluster. */
export function resolveHeroPortalId(
	heroPortalId: string | null | undefined,
	rootPortalIds: readonly string[] | undefined,
): string | null {
	if (!heroPortalId || !rootPortalIds?.includes(heroPortalId)) return null;
	return heroPortalId;
}
