/**
 * Phaser's TimeStep treats any frame longer than 1000 / fps.min ms (default
 * 5 fps = 200 ms) as a stall and swaps it for an older "sane" delta from its
 * history, which is initialised to 16.7 ms. A machine that sustains under
 * 5 fps therefore reports ~16.7 ms every frame, the arcade world takes one
 * 1/60 s step per frame, and walking runs at (fps / 60) of nominal speed.
 * Raising the cap lets slow frames report their real length; arcade physics
 * then catches up with several 1/60 s sub-steps per frame, so colliders are
 * still evaluated every 1/60 s of movement, exactly as at 60 fps.
 * Frames beyond the cap (a stalled or just-resumed tab) are still replaced.
 *
 * Second cause: after start and after every focus regain TimeStep enters a
 * `panicMax` cooldown (default 120 frames) in which every delta is clamped to
 * 16.7 ms. At 5 fps that is the first 24 s of play; a short cooldown still
 * absorbs the first frames after a resume. `smoothStep` stays on: its
 * replacement of over-cap frames is the only stall protection, at the price of
 * a ramp over the first 10 frames after start or resume.
 */
export const MIN_FPS = 2;

export const PANIC_FRAMES = 5;

export const PHASER_FPS_CONFIG = {
	min: MIN_FPS,
	panicMax: PANIC_FRAMES,
} as const;

/** Longest frame, in ms, Phaser reports as real time under `PHASER_FPS_CONFIG`. */
export const MAX_FRAME_MS = 1000 / MIN_FPS;

const REFERENCE_FRAME_MS = 1000 / 60;

/** Camera-follow lerp factor `k` is tuned per 60 fps frame; this is the factor that covers the same fraction of the gap in `deltaMs`. */
export function followLerp(k: number, deltaMs: number): number {
	const dt = Math.min(Math.max(deltaMs, 0), MAX_FRAME_MS);
	return 1 - (1 - k) ** (dt / REFERENCE_FRAME_MS);
}
