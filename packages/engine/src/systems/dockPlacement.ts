import type { Rect } from "./portalFx.js";

export const DOCK_MARGIN_PX = 16;
/** Narrowest the dock gets before it moves sides instead: its slot then lays a page out at ~440px (portalFx.ts#dockLayoutWidth), still readable. */
export const DOCK_MIN_WIDTH_PX = 320;
/** Air between the dock and the arch/orbit it keeps clear of. */
export const DOCK_KEEPOUT_GAP_PX = 8;

export type DockSide = "left" | "right";

export interface DockPlacement {
	side: DockSide;
	width: number;
}

/**
 * Where the preview dock goes so it doesn't cover the arch the player is
 * standing at (and that arch's orbiting monsters): its usual right-hand
 * spot at its usual width when that's clear; else narrower, down to
 * DOCK_MIN_WIDTH_PX; else the left edge, away from the arch; else — nothing
 * clears on a very narrow screen — the minimum width on whichever side
 * overlaps less. All in the same px space as `keepout`.
 */
export function placeDock(
	containerWidth: number,
	preferredWidth: number,
	dockSpan: { top: number; bottom: number },
	keepout: Rect | null,
): DockPlacement {
	const usual: DockPlacement = { side: "right", width: preferredWidth };
	if (
		!keepout ||
		keepout.y >= dockSpan.bottom ||
		keepout.y + keepout.h <= dockSpan.top
	)
		return usual;
	const roomRight =
		containerWidth -
		DOCK_MARGIN_PX -
		(keepout.x + keepout.w + DOCK_KEEPOUT_GAP_PX);
	if (roomRight >= preferredWidth) return usual;
	if (roomRight >= DOCK_MIN_WIDTH_PX)
		return { side: "right", width: Math.floor(roomRight) };
	const roomLeft = keepout.x - DOCK_KEEPOUT_GAP_PX - DOCK_MARGIN_PX;
	if (roomLeft >= DOCK_MIN_WIDTH_PX)
		return {
			side: "left",
			width: Math.floor(Math.min(preferredWidth, roomLeft)),
		};
	return {
		side: roomLeft > roomRight ? "left" : "right",
		width: Math.min(preferredWidth, DOCK_MIN_WIDTH_PX),
	};
}
