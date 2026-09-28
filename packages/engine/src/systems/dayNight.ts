import type { TimeOfDay } from "./timeOfDay.js";

/** How long a day<->night toggle takes to cross-fade. Reduced motion swaps instantly instead (see stepBlend). */
export const DAY_NIGHT_CROSSFADE_MS = 600;

/**
 * Multiply-blend grade colors for render/atmosphere.ts's full-screen grade
 * layer. DAY is a faint warm "sun" cast; NIGHT is the deep blue-violet the
 * 2026-09-28 playtest asked for ("essentially a dark mode"). Multiply means a
 * channel's value is the fraction of that channel that survives, so NIGHT
 * keeps ~2x as much blue as red/green: grass reads as dark teal-blue instead
 * of merely dim green, which is what the old glow-shader-only grade produced.
 */
export const DAY_GRADE_COLOR = 0xfff4e2;
export const NIGHT_GRADE_COLOR = 0x46489a;

/** 0 = full day, 1 = full night. */
export function targetBlend(timeOfDay: TimeOfDay): number {
	return timeOfDay === "night" ? 1 : 0;
}

/**
 * Advances the day/night blend toward `target` by one frame. Linear in time
 * so a 600ms fade takes 600ms whatever the frame rate; easing is applied
 * where the value is consumed (easeBlend), not here, so the stepping stays
 * trivially reversible mid-fade (a toggle during a fade just turns around).
 */
export function stepBlend(
	current: number,
	target: number,
	deltaMs: number,
	durationMs: number,
	reducedMotion: boolean,
): number {
	if (reducedMotion || durationMs <= 0) return target;
	const step = Math.max(0, deltaMs) / durationMs;
	if (current < target) return Math.min(target, current + step);
	if (current > target) return Math.max(target, current - step);
	return current;
}

/** Smoothstep — the fade starts and lands gently instead of a linear ramp's visible kink at each end. */
export function easeBlend(t: number): number {
	const c = Math.min(1, Math.max(0, t));
	return c * c * (3 - 2 * c);
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Per-channel lerp between two 0xRRGGBB colors. */
export function lerpColor(a: number, b: number, t: number): number {
	const ar = (a >> 16) & 0xff;
	const ag = (a >> 8) & 0xff;
	const ab = a & 0xff;
	const br = (b >> 16) & 0xff;
	const bg = (b >> 8) & 0xff;
	const bb = b & 0xff;
	const r = Math.round(lerp(ar, br, t));
	const g = Math.round(lerp(ag, bg, t));
	const bl = Math.round(lerp(ab, bb, t));
	return (r << 16) | (g << 8) | bl;
}

export function gradeColorAt(blend: number): number {
	return lerpColor(DAY_GRADE_COLOR, NIGHT_GRADE_COLOR, easeBlend(blend));
}

/**
 * Lamp/window/bonfire flicker as a pure function of time rather than a
 * Phaser tween, so the light pool's additive sprite and the matching hole
 * erased from the night grade (render/atmosphere.ts) always pulse in exact
 * lockstep. Two incommensurate sines read as an irregular flame instead of a
 * metronome. Returns a multiplier in roughly [0.8, 1].
 */
export function flickerAt(timeMs: number, phase: number): number {
	const a = Math.sin(timeMs * 0.0061 + phase);
	const b = Math.sin(timeMs * 0.0137 + phase * 2.3);
	return 0.9 + 0.07 * a + 0.03 * b;
}
