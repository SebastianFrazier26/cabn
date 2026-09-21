export type Facing = "front" | "back";

/**
 * Which way the character sprite should face given the player's current
 * velocity. Horizontal and downward movement (and standing still) all read
 * fine on the single front-facing sprite (flipX handles left/right); only
 * "mostly moving up" needs the separate back-view texture.
 */
export function facingFromVelocity(vx: number, vy: number): Facing {
	if (vy < 0 && Math.abs(vy) > Math.abs(vx)) return "back";
	return "front";
}
