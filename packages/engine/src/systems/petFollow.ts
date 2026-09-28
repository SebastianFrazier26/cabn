/**
 * How a pet trails the player (render/petCompanion.ts is the Phaser side):
 * it heads for a spot a little behind the player, relative to the way they
 * last walked, eases in with a speed cap so it visibly lags, and snaps
 * straight there after a jump it could never catch up with (a teleport, a
 * restored save position).
 */

export interface Point {
	x: number;
	y: number;
}

export interface PetFollowState {
	pos: Point;
	/** Unit vector of the player's last real movement — "behind" is opposite it. */
	heading: Point;
	lastPlayer: Point;
	moving: boolean;
	facingLeft: boolean;
}

export const PET_FOLLOW = {
	/** How far behind the player the pet settles. */
	trailDistance: 30,
	/** Pets sit a little below the player's centre, so their feet line up. */
	footOffsetY: 16,
	/** Below this distance from its spot the pet stops walking. */
	settleRadius: 6,
	/** Faster than the player's walk so it keeps up, slower than instant so it lags. */
	maxSpeedPxPerSec: 260,
	/** Fraction of the remaining gap closed per 1/60s frame, before the cap. */
	easePerFrame: 0.12,
	snapDistance: 360,
} as const;

export function initialPetFollow(player: Point): PetFollowState {
	return {
		pos: {
			x: player.x - PET_FOLLOW.trailDistance,
			y: player.y + PET_FOLLOW.footOffsetY,
		},
		heading: { x: 1, y: 0 },
		lastPlayer: { ...player },
		moving: false,
		facingLeft: false,
	};
}

export function petFollowTarget(player: Point, heading: Point): Point {
	return {
		x: player.x - heading.x * PET_FOLLOW.trailDistance,
		y:
			player.y +
			PET_FOLLOW.footOffsetY -
			heading.y * PET_FOLLOW.trailDistance * 0.6,
	};
}

export function stepPetFollow(
	state: PetFollowState,
	player: Point,
	deltaMs: number,
): PetFollowState {
	const dx = player.x - state.lastPlayer.x;
	const dy = player.y - state.lastPlayer.y;
	const moved = Math.hypot(dx, dy);
	const heading =
		moved > 0.5 ? { x: dx / moved, y: dy / moved } : state.heading;
	const target = petFollowTarget(player, heading);
	const gx = target.x - state.pos.x;
	const gy = target.y - state.pos.y;
	const gap = Math.hypot(gx, gy);

	if (gap > PET_FOLLOW.snapDistance) {
		return {
			pos: target,
			heading,
			lastPlayer: { ...player },
			moving: false,
			facingLeft: heading.x < 0,
		};
	}
	if (gap <= PET_FOLLOW.settleRadius) {
		return {
			...state,
			heading,
			lastPlayer: { ...player },
			moving: false,
		};
	}
	const frames = Math.max(deltaMs, 0) / (1000 / 60);
	const eased = gap * (1 - (1 - PET_FOLLOW.easePerFrame) ** frames);
	const capped = (PET_FOLLOW.maxSpeedPxPerSec * Math.max(deltaMs, 0)) / 1000;
	const step = Math.min(eased, capped, gap);
	const facingLeft = Math.abs(gx) > 1 ? gx < 0 : state.facingLeft;
	return {
		pos: {
			x: state.pos.x + (gx / gap) * step,
			y: state.pos.y + (gy / gap) * step,
		},
		heading,
		lastPlayer: { ...player },
		moving: step > 0.05,
		facingLeft,
	};
}
