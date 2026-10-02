import { hashStringSeed } from "./deterministicRandom.js";

const TAU = Math.PI * 2;

export interface Point {
	x: number;
	y: number;
}

/** A flattened (3/4-view) ellipse a portal's monsters circle on. */
export interface OrbitEllipse {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
}

/**
 * Derived from the arch's display size, not its sprite: rx sits just outside
 * the visible stone (~200/256 of the frame wide, so ~0.39x each side) so a
 * ~36px monster brushes past the pillars instead of through them, and cy is
 * pushed below the sprite centre because the arch's opening runs to the
 * frame's bottom edge — an orbit on the true centre would pass in front of
 * the capstone and read as "above" the portal, not around it.
 */
export function portalOrbitEllipse(
	portal: Point,
	archDisplayPx: number,
): OrbitEllipse {
	return {
		cx: portal.x,
		cy: portal.y + archDisplayPx * 0.22,
		rx: archDisplayPx * 0.5,
		ry: archDisplayPx * 0.2,
	};
}

export interface OrbitRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Which orbit a portal's monsters fly: a web arch carries a DOM live page over its opening that would hide anything passing through it. */
export type PortalOrbitShape =
	| { kind: "arch" }
	| {
			kind: "web";
			/** The live page's rect in world space (portalFx.ts#openingRect). */
			opening: OrbitRect;
			/** Worst-case reach of a sibling's drawn sprite from its orbit point (monsterClearancePx). */
			clearancePx: number;
	  };

/** ry/rx of the web orbit — still flattened so it reads as a 3/4-view loop, but much less than the arch orbit, see webPortalOrbitEllipse. */
const WEB_ORBIT_FLATTEN = 0.75;
/** sampleOrbit's nearest-point perspective scale. */
const MAX_PERSPECTIVE_SCALE = 1.08;

export function portalOrbitEllipseFor(
	portal: Point,
	archDisplayPx: number,
	shape: PortalOrbitShape,
): OrbitEllipse {
	return shape.kind === "web"
		? webPortalOrbitEllipse(shape.opening, shape.clearancePx)
		: portalOrbitEllipse(portal, archDisplayPx);
}

/**
 * A loop around the opening that never enters it, even at a species' most
 * inward radial wobble: centred on the opening and sized so the smallest
 * wobbled ellipse still encloses the opening grown by `clearancePx` on every
 * side. Any closed loop around the arch has to cross above and below the
 * ~125px-tall opening, so this ends up taller than the arch orbit, not
 * flatter; the alternative — a flat loop parked wholly below the arch —
 * stops reading as "around the portal" and sits where the player stands.
 */
export function webPortalOrbitEllipse(
	opening: OrbitRect,
	clearancePx: number,
): OrbitEllipse {
	const hx = opening.w / 2 + clearancePx;
	const hy = opening.h / 2 + clearancePx;
	const minRadial = 1 - MAX_RADIAL_WOBBLE;
	// 1.02: strictly clear of the grown corner rather than tangent to it.
	const rx = (Math.hypot(hx, hy / WEB_ORBIT_FLATTEN) / minRadial) * 1.02;
	return {
		cx: opening.x + opening.w / 2,
		cy: opening.y + opening.h / 2,
		rx,
		ry: rx * WEB_ORBIT_FLATTEN,
	};
}

/**
 * How far a monster's drawn sprite (its axis-aligned bounds) can reach from
 * its orbit point: half its displayed size at the nearest-point perspective
 * scale, widened for rotation (a sway tilts it, the ouroboros spins through
 * 45°), plus the bob.
 */
export function monsterClearancePx(species: string, displayPx: number): number {
	const p = motionProfile(species);
	const tilt =
		p.spinRadPerSec > 0 ? Math.PI / 4 : Math.min(p.swayRad, Math.PI / 4);
	return (
		(displayPx / 2) *
			MAX_PERSPECTIVE_SCALE *
			(Math.cos(tilt) + Math.sin(tilt)) +
		p.bobPx
	);
}

export interface OrbitSample extends Point {
	/** Lower half of the ellipse — drawn in front of the arch; upper half passes behind it. */
	inFront: boolean;
	/** Mild perspective: ~1.08 at the nearest point, ~0.92 at the farthest. */
	scale: number;
	/** Screen-space horizontal travel direction (+1 right, -1 left) for sprite flipping. */
	travelX: 1 | -1;
}

export function sampleOrbit(
	e: OrbitEllipse,
	angle: number,
	direction: 1 | -1 = 1,
	radialScale = 1,
): OrbitSample {
	const s = Math.sin(angle);
	const c = Math.cos(angle);
	// d/dθ of cos is -sin; the orbit's direction flips the sign.
	const dx = -s * direction;
	return {
		x: e.cx + c * e.rx * radialScale,
		y: e.cy + s * e.ry * radialScale,
		inFront: s >= 0,
		scale: 1 + 0.08 * s,
		travelX: dx >= 0 ? 1 : -1,
	};
}

/** Siblings on one portal share a speed and are spaced evenly in phase, so they never bunch up regardless of species. */
export function orbitAngle(
	index: number,
	count: number,
	timeSec: number,
	speedRadPerSec: number,
	direction: 1 | -1,
	offset: number,
): number {
	const n = Math.max(count, 1);
	return offset + (TAU * index) / n + direction * speedRadPerSec * timeSec;
}

/**
 * Reduced-motion placement: spread across the front half (plus a sliver of
 * each side) so every monster stays visible in front of the arch rather
 * than parking one behind the stone where nothing will ever move it out.
 */
export function staticOrbitAngle(index: number, count: number): number {
	if (count <= 1) return Math.PI * 0.2;
	const start = -Math.PI * 0.02;
	const end = Math.PI * 1.02;
	return start + ((end - start) * index) / (count - 1);
}

/** Stable per-portal phase offset and spin direction, so neighbouring arches don't swirl in lockstep. */
export function portalOrbitSeed(portalId: string): {
	offset: number;
	direction: 1 | -1;
} {
	const h = hashStringSeed(`orbit:${portalId}`);
	return {
		offset: ((h & 0xffff) / 0x10000) * TAU,
		direction: h & 0x10000 ? 1 : -1,
	};
}

/**
 * Lemniscate of Gerono-style figure-eight along a path (an infinity sign —
 * reads as "cycle" for the ouroboros that marks a circular import between
 * two clusters), centred at `center` and aligned to `pathAngle`. `halfLength`
 * is the loop's reach either side of centre.
 */
export function pathFigureEight(
	center: Point,
	pathAngle: number,
	halfLength: number,
	t: number,
): Point {
	const lx = Math.cos(t) * halfLength;
	const ly = Math.sin(t) * Math.cos(t) * halfLength * 0.6;
	const ca = Math.cos(pathAngle);
	const sa = Math.sin(pathAngle);
	return {
		x: center.x + lx * ca - ly * sa,
		y: center.y + lx * sa + ly * ca,
	};
}

export type TrailBlend = "add" | "normal";

export interface MonsterTrail {
	tint: number;
	blend: TrailBlend;
	alpha: number;
	everyMs: number;
	/** Upward drift (px/s) — wisps rise, dust and leaves settle. */
	riseY: number;
}

export type MotionKind = "drift" | "hop" | "flutter" | "creep" | "coil";

export interface MotionProfile {
	kind: MotionKind;
	bobPx: number;
	bobHz: number;
	/** Fraction of the orbit radius the monster breathes in/out by. */
	radialWobble: number;
	/** Alpha flicker depth (0 = steady). */
	flicker: number;
	/** Rotation sway amplitude in radians. */
	swayRad: number;
	/** Constant spin in rad/s (the ouroboros rolling round its own coil). */
	spinRadPerSec: number;
	baseAlpha: number;
	/** Which way the art faces, so the sprite can be flipped to face its travel; null for front-on/symmetric art. */
	facing: "left" | "right" | null;
	trail: MonsterTrail | null;
}

const BASE: MotionProfile = {
	kind: "drift",
	bobPx: 4,
	bobHz: 0.7,
	radialWobble: 0.04,
	flicker: 0,
	swayRad: 0,
	spinRadPerSec: 0,
	baseAlpha: 1,
	facing: null,
	trail: null,
};

// Tints are PALETTE-adjacent hexes from assets/generated/palette.json so the
// trails sit in the same colour family as the sprites that shed them.
const PROFILES: Record<string, Partial<MotionProfile>> = {
	ghost: {
		kind: "drift",
		bobPx: 5,
		bobHz: 0.5,
		facing: "right",
		trail: {
			tint: 0xbfd6e0,
			blend: "add",
			alpha: 0.55,
			everyMs: 140,
			riseY: -6,
		},
	},
	shade: {
		kind: "drift",
		bobPx: 4,
		bobHz: 0.45,
		baseAlpha: 0.92,
		trail: {
			tint: 0x58336b,
			blend: "normal",
			alpha: 0.45,
			everyMs: 150,
			riseY: -4,
		},
	},
	"will-o-wisp": {
		kind: "drift",
		bobPx: 6,
		bobHz: 0.9,
		radialWobble: 0.08,
		flicker: 0.3,
		baseAlpha: 0.7,
		trail: {
			tint: 0xbee6cd,
			blend: "add",
			alpha: 0.7,
			everyMs: 110,
			riseY: -10,
		},
	},
	magpie: {
		kind: "flutter",
		bobPx: 7,
		bobHz: 1.6,
		radialWobble: 0.06,
		facing: "left",
		trail: { tint: 0xf0d05c, blend: "add", alpha: 0.6, everyMs: 220, riseY: 4 },
	},
	"rot-sprite": {
		kind: "hop",
		bobPx: 7,
		bobHz: 1.1,
		trail: {
			tint: 0xb4e678,
			blend: "normal",
			alpha: 0.5,
			everyMs: 260,
			riseY: -3,
		},
	},
	gremlin: {
		kind: "hop",
		bobPx: 8,
		bobHz: 1.5,
		trail: {
			tint: 0xeb8c3c,
			blend: "add",
			alpha: 0.55,
			everyMs: 240,
			riseY: -8,
		},
	},
	imp: {
		kind: "hop",
		bobPx: 6,
		bobHz: 1.8,
		radialWobble: 0.05,
		swayRad: 0.08,
		trail: {
			tint: 0xeb8c3c,
			blend: "add",
			alpha: 0.6,
			everyMs: 200,
			riseY: -10,
		},
	},
	skeleton: {
		kind: "hop",
		bobPx: 4,
		bobHz: 1.4,
		swayRad: 0.12,
		trail: {
			tint: 0xefe0b3,
			blend: "normal",
			alpha: 0.5,
			everyMs: 280,
			riseY: 3,
		},
	},
	"warded-mimic": {
		kind: "hop",
		bobPx: 5,
		bobHz: 0.6,
		swayRad: 0.05,
		trail: {
			tint: 0xf0d05c,
			blend: "add",
			alpha: 0.5,
			everyMs: 320,
			riseY: -4,
		},
	},
	bramble: {
		kind: "creep",
		bobPx: 2,
		bobHz: 0.4,
		swayRad: 0.14,
		trail: {
			tint: 0x78c85a,
			blend: "normal",
			alpha: 0.55,
			everyMs: 300,
			riseY: 5,
		},
	},
	ouroboros: {
		kind: "coil",
		bobPx: 3,
		bobHz: 0.35,
		spinRadPerSec: 0.9,
		trail: {
			tint: 0xb27cd6,
			blend: "add",
			alpha: 0.5,
			everyMs: 170,
			riseY: -2,
		},
	},
};

/** motionOffset's radialScale never drops below 1 minus this, for any species. */
export const MAX_RADIAL_WOBBLE = Math.max(
	BASE.radialWobble,
	...Object.values(PROFILES).map((p) => p.radialWobble ?? BASE.radialWobble),
);

/** Unknown species fall back to the shade's drift, matching the sprite fallback (render/monsterSprite.ts). */
export function motionProfile(species: string): MotionProfile {
	return { ...BASE, ...(PROFILES[species] ?? PROFILES.shade) };
}

export interface MotionOffset {
	dy: number;
	radialScale: number;
	rotation: number;
	alpha: number;
}

/**
 * Per-species flavour layered on the shared orbit: a hop is |sin| (feet leave
 * and meet the ground), a drift is a smooth sine, a creep barely lifts but
 * sways. `seed` (0..1) de-syncs siblings on the same arch.
 */
export function motionOffset(
	profile: MotionProfile,
	timeSec: number,
	seed: number,
): MotionOffset {
	const phase = TAU * (profile.bobHz * timeSec + seed);
	let dy: number;
	switch (profile.kind) {
		case "hop":
			dy = -Math.abs(Math.sin(phase / 2)) * profile.bobPx;
			break;
		case "flutter":
			dy =
				Math.sin(phase) * profile.bobPx * 0.6 -
				Math.abs(Math.sin(phase * 2)) * profile.bobPx * 0.4;
			break;
		default:
			dy = Math.sin(phase) * profile.bobPx;
	}
	const flicker =
		profile.flicker > 0
			? profile.flicker *
				(0.5 + 0.5 * Math.sin(phase * 3.7) * Math.sin(phase * 1.3))
			: 0;
	return {
		dy,
		radialScale: 1 + profile.radialWobble * Math.sin(phase * 0.5 + seed * TAU),
		rotation:
			profile.swayRad * Math.sin(phase * 0.5) + profile.spinRadPerSec * timeSec,
		alpha: Math.max(0, Math.min(1, profile.baseAlpha - flicker)),
	};
}

/** Pure fallback chain for a species' sprite: itself, then shade, then ghost. `available` answers whether a species' texture/animation loaded. */
export function resolveMonsterSpecies(
	species: string,
	available: (species: string) => boolean,
): string {
	if (available(species)) return species;
	if (available("shade")) return "shade";
	return "ghost";
}
