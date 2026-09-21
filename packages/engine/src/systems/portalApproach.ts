import type { Position } from "@cabn/world-schema";

export function distance(a: Position, b: Position): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isWithinRadius(
	playerPos: Position,
	targetPos: Position,
	radius: number,
): boolean {
	return distance(playerPos, targetPos) <= radius;
}

export interface PortalPoint {
	portalId: string;
	pos: Position;
}

/**
 * Diffs the previous frame's in-range set against the current player position
 * to find portals newly entering approach range this frame — the transition
 * WorldScene needs to fire a one-shot `portal:approach` event exactly once
 * per approach, not every frame the player stays inside the radius.
 */
export function newlyApproached(
	portals: readonly PortalPoint[],
	playerPos: Position,
	radius: number,
	previouslyInRange: ReadonlySet<string>,
): { inRange: Set<string>; entered: string[] } {
	const inRange = new Set<string>();
	const entered: string[] = [];
	for (const portal of portals) {
		if (isWithinRadius(playerPos, portal.pos, radius)) {
			inRange.add(portal.portalId);
			if (!previouslyInRange.has(portal.portalId))
				entered.push(portal.portalId);
		}
	}
	return { inRange, entered };
}
