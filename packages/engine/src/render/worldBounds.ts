import type { WorldBounds } from "./pathBaker.js";

export interface ViewportSize {
	width: number;
	height: number;
}

// A defensive floor only — guards a degenerate (zero-size) viewport from
// producing a zero-width bounds box, not a "how far the camera should see"
// number. Real viewports never hit this; kept small so it never masks the
// viewport-derived margin below.
const MIN_BOUNDS_MARGIN_PX = 200;

// Half the viewport is the least padding that guarantees bounds width/height
// >= viewport width/height (see this function's own doc) — but when every
// point shares the same x (or y), e.g. two cabins directly north/south of
// each other on the shelf, or any single-cluster world, that minimum makes
// bounds width/height *exactly* equal the viewport on that axis: zero scroll
// room, so `cameras.main.startFollow()` can never pan there at all and the
// camera sits dead-centre on the origin no matter where the player walks.
// Confirmed by e2e/smoke.spec.ts's click-to-move assertion, which failed
// deterministically on this demo's own two-cabin shelf (both cabins at
// x=0) until this was added. This is on top of, not instead of, the
// void-safety padding above — it doesn't scale with world size, so it
// doesn't erode this fix's actual point (shrinking the bake) the way going
// back to the old viewport/2+150-on-every-side scheme would.
const MIN_FOLLOW_ROOM_PX = 150;

/**
 * Shared by ShelfScene and WorldScene: their ground/path bake and their
 * camera/physics bounds all call this with the same point set (cluster or
 * cabin positions) and the same live viewport — one shared box, not three
 * slightly different ones, which is exactly how a field baked for one area
 * and a camera clamped to another used to leave a sliver of void at the
 * edge (see each scene's own computeWorldBounds call site).
 *
 * Padding is half the viewport per axis, plus MIN_FOLLOW_ROOM_PX — not a
 * flat margin, and not the old scheme's single combined
 * `viewport/2 + 150` applied to every side regardless of axis. Phaser's
 * camera never scrolls its own view rectangle outside the bounds it's
 * given, but it also doesn't *crop* rendering to those bounds: if the
 * viewport were wider or taller than the bounds box, the rendered view
 * would extend past it into whatever's baked there, which is nothing.
 * Padding by half the viewport on each axis guarantees bounds width/height
 * >= viewport width/height on that axis, so the camera's own bounds are
 * always at least as large as what it has to render, at any viewport size;
 * MIN_FOLLOW_ROOM_PX on top of that guarantees the camera always has real
 * room to pan, not just to avoid showing a void.
 */
export function computeWorldBounds(
	points: readonly { x: number; y: number }[],
	viewport: ViewportSize,
): WorldBounds {
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const marginX =
		Math.max(MIN_BOUNDS_MARGIN_PX, viewport.width / 2) + MIN_FOLLOW_ROOM_PX;
	const marginY =
		Math.max(MIN_BOUNDS_MARGIN_PX, viewport.height / 2) + MIN_FOLLOW_ROOM_PX;
	return {
		minX: Math.min(0, ...xs) - marginX,
		maxX: Math.max(0, ...xs) + marginX,
		minY: Math.min(0, ...ys) - marginY,
		maxY: Math.max(0, ...ys) + marginY,
	};
}
