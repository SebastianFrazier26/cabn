/**
 * Pure logic behind click-to-move / click-to-interact (render/clickWalker.ts
 * is the Phaser side). There is no collision system to path around — the
 * player's arcade body only collides with the world bounds — so movement is
 * a straight line to a bounds-clamped goal, with a progress watchdog that
 * gives up if the body stops making headway instead of pushing into a wall
 * forever.
 */
import { distance } from "./portalApproach.js";

export interface Point {
	x: number;
	y: number;
}

export type InteractableKind =
	| "portal"
	| "cabin"
	| "monster"
	| "bonfire"
	| "exit";

export interface Interactable {
	id: string;
	kind: InteractableKind;
	pos: Point;
	/** Clicks within this distance of `pos` pick this interactable. */
	hitRadius: number;
	/** Walking stops (and the interaction fires) once within this distance of `pos`. Keep it inside the scene's own Enter radius for this kind, so the arrival interaction lands the same way a key press there would. */
	arriveRadius: number;
	/** Higher wins when several hit areas overlap the click (a monster hovering in front of its arch). Defaults to 0. */
	priority?: number;
}

export type ClickTarget =
	| { kind: "ground"; point: Point }
	| { kind: "interactable"; target: Interactable };

/** The interactable under `point` (highest priority, then nearest centre), else a plain ground target. */
export function resolveClickTarget(
	point: Point,
	interactables: readonly Interactable[],
): ClickTarget {
	let best: { target: Interactable; dist: number; priority: number } | null =
		null;
	for (const target of interactables) {
		const dist = distance(point, target.pos);
		if (dist > target.hitRadius) continue;
		const priority = target.priority ?? 0;
		if (
			!best ||
			priority > best.priority ||
			(priority === best.priority && dist < best.dist)
		) {
			best = { target, dist, priority };
		}
	}
	return best
		? { kind: "interactable", target: best.target }
		: { kind: "ground", point };
}

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Keeps a ground goal reachable: a click past the physics bounds would otherwise walk into the edge until the watchdog gave up. `inset` leaves room for the body's own half-size. */
export function clampToBounds(point: Point, bounds: Bounds, inset = 0): Point {
	return {
		x: Math.min(Math.max(point.x, bounds.minX + inset), bounds.maxX - inset),
		y: Math.min(Math.max(point.y, bounds.minY + inset), bounds.maxY - inset),
	};
}

export interface SteerResult {
	arrived: boolean;
	/** Unit direction scaled by how much of a full-speed step is still needed (<= 1), so the last frame lands on the goal instead of overshooting and oscillating around it. Zero vector when arrived. */
	velocity: Point;
}

export function steerToward(
	pos: Point,
	goal: Point,
	arriveRadius: number,
	speedPxPerSec: number,
	deltaMs: number,
): SteerResult {
	const dx = goal.x - pos.x;
	const dy = goal.y - pos.y;
	const dist = Math.hypot(dx, dy);
	if (dist <= arriveRadius) return { arrived: true, velocity: { x: 0, y: 0 } };
	const stepPx = (speedPxPerSec * Math.max(deltaMs, 0)) / 1000;
	const remaining = dist - arriveRadius;
	const scale = stepPx > 0 ? Math.min(1, remaining / stepPx) : 1;
	return {
		arrived: false,
		velocity: { x: (dx / dist) * scale, y: (dy / dist) * scale },
	};
}

export interface ProgressWatch {
	anchor: Point;
	elapsedMs: number;
}

export interface ProgressOptions {
	/** How long a sample window is. */
	windowMs: number;
	/** Minimum net displacement expected over one window while walking. */
	minProgressPx: number;
}

export const DEFAULT_PROGRESS_OPTIONS: ProgressOptions = {
	windowMs: 500,
	minProgressPx: 10,
};

export function startProgressWatch(pos: Point): ProgressWatch {
	return { anchor: { ...pos }, elapsedMs: 0 };
}

/** Samples net displacement once per window; `stuck` is true when a full window passed with less than `minProgressPx` of movement. */
export function trackProgress(
	watch: ProgressWatch,
	pos: Point,
	deltaMs: number,
	options: ProgressOptions = DEFAULT_PROGRESS_OPTIONS,
): { watch: ProgressWatch; stuck: boolean } {
	const elapsedMs = watch.elapsedMs + deltaMs;
	if (elapsedMs < options.windowMs) {
		return { watch: { anchor: watch.anchor, elapsedMs }, stuck: false };
	}
	const moved = distance(watch.anchor, pos);
	return {
		watch: startProgressWatch(pos),
		stuck: moved < options.minProgressPx,
	};
}
