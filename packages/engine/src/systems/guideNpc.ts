/**
 * Pure rules behind the guide NPC (render/guideNpc.ts is the Phaser side):
 * which world gets her, and where she stands.
 */
import {
	type CircleKeepout,
	type Footprint,
	footprintClear,
	type SegmentKeepout,
} from "./edgeScenery.js";

export interface Point {
	x: number;
	y: number;
}

/**
 * "The first world" is the first entry of shelf.json's `worlds` array — the
 * order `cabn shelf` wrote them in and the order ShelfScene lays the cabins
 * out, so it's the cabin a new player meets first. A world booted on its own
 * (a host passing `worldUrl`, e.g. `cabn serve`) has no shelf and counts as
 * first: it's the only world that player has. cabn.json's `guide: false`
 * (carried into world.json as `guide`) always wins.
 */
export function shouldShowGuide(
	shelfIndex: number | undefined,
	manifestGuide: boolean | undefined,
): boolean {
	if (manifestGuide === false) return false;
	return shelfIndex === undefined || shelfIndex === 0;
}

export interface GuidePlacementInput {
	/** The bonfire (root cluster centre) she stands beside. */
	hub: Point;
	circles: readonly CircleKeepout[];
	segments: readonly SegmentKeepout[];
	/** Her sprite's box, anchored bottom-centre at the returned point's feet — see footprintClear. */
	footprint: Footprint;
	minRadius: number;
	maxRadius: number;
	/** Tried first; candidates fan out from here alternating either side. West by default — the fresh-save spawn is east of the fire. */
	preferredAngle?: number;
	preferredRadius?: number;
}

const ANGLE_STEPS = 24;
const RADIUS_STEP = 8;

/**
 * The first clear spot on rings around the bonfire, nearest the preferred
 * angle and radius first — the same keepout test edge scenery uses, so she
 * never stands on a path ribbon, an arch, the spawn point or the fire
 * itself. Returns her centre point (the sprite's origin), or null when every
 * candidate is blocked (the world then has no guide rather than one standing
 * on something). Deterministic: same input, same spot.
 */
export function placeGuideNpc(input: GuidePlacementInput): Point | null {
	const preferredAngle = input.preferredAngle ?? Math.PI;
	const preferredRadius = Math.min(
		input.maxRadius,
		Math.max(input.minRadius, input.preferredRadius ?? input.minRadius),
	);
	const radii: number[] = [preferredRadius];
	for (let k = 1; k * RADIUS_STEP <= input.maxRadius - input.minRadius; k++) {
		const out = preferredRadius + k * RADIUS_STEP;
		const inward = preferredRadius - k * RADIUS_STEP;
		if (out <= input.maxRadius) radii.push(out);
		if (inward >= input.minRadius) radii.push(inward);
	}
	const angles: number[] = [preferredAngle];
	for (let k = 1; k <= ANGLE_STEPS / 2; k++) {
		const step = (k * Math.PI * 2) / ANGLE_STEPS;
		angles.push(preferredAngle + step, preferredAngle - step);
	}
	const halfH = input.footprint.h / 2;
	for (const radius of radii) {
		for (const angle of angles) {
			const x = input.hub.x + Math.cos(angle) * radius;
			const y = input.hub.y + Math.sin(angle) * radius;
			if (
				footprintClear(
					x,
					y + halfH,
					input.footprint,
					input.circles,
					input.segments,
					0,
				)
			) {
				// `+ 0` folds a -0 from a tiny negative sine into 0.
				return { x: Math.round(x) + 0, y: Math.round(y) + 0 };
			}
		}
	}
	return null;
}
