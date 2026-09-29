// Pure timing/sequencing for the M10a scene transitions (SceneTransitionOverlay.tsx,
// ShelfScene's cabin enter/exit) — a single source of truth so the React overlay's
// CSS animation durations and the Phaser scenes' "how long to hold before the
// hard scene.start cut" delay never drift apart. Every export here is a plain
// number/pure function, no DOM/Phaser dependency, per this repo's "test the
// pure logic, skip the scene glue" convention.

/** Full-motion, per-side fade duration for the Stardew-style cabin enter/exit fade (systems/sceneTransition.ts's cabinTransitionDelayMs/TotalMs). */
export const CABIN_FADE_MS = 220;
/** How long the screen holds fully black before fading back in — covers ShelfScene/WorldScene's scene.start("boot", ...) call and the new scene's preload/create, which are fast (a handful of frames) but not instant. */
export const CABIN_HOLD_MS = 120;

/** Pokemon-style encounter intro: a flash, then horizontal bars closing to a hold, then opening again for the reveal. */
export const ENCOUNTER_FLASH_MS = 90;
export const ENCOUNTER_WIPE_MS = 200;
export const ENCOUNTER_REVEAL_MS = 160;

/** Scroll-unroll/page-turn wipe for entering or leaving a file portal — matches STYLE.md's "scroll-unroll (~340ms)" motion-table entry. */
export const PORTAL_WIPE_MS = 340;

/** World layer toggle: a coloured pulse (the layer skin's colour) that peaks while WorldScene restarts, then clears so the layer's rise is visible. */
export const LAYER_PULSE_IN_MS = 240;
export const LAYER_PULSE_OUT_MS = 360;
/** How long a layer's objects take to rise out of (or sink into) the ground. */
export const LAYER_RISE_MS = 700;

/** Flat fade every transition kind collapses to under prefers-reduced-motion, per IMPLEMENTATION-PLAN.md/STYLE.md's "reduced by default, enhanced under :no-preference" rule — short enough to still register as *a* transition beat, not long enough to feel like a stall. */
export const REDUCED_MOTION_FADE_MS = 150;

/**
 * How long ShelfScene/WorldScene should wait after emitting the
 * shelf:enter-world/world:return-to-shelf bus event before actually calling
 * `scene.start("boot", ...)` — long enough for the fade-out half of the cabin
 * transition to finish covering the screen first, so the hard cut lands
 * while the screen is black instead of mid-fade.
 */
export function cabinTransitionDelayMs(reducedMotion: boolean): number {
	return reducedMotion ? REDUCED_MOTION_FADE_MS : CABIN_FADE_MS;
}

/** Total time the cabin fade overlay stays mounted (fade out + hold + fade in), for the React side's own animation-duration bookkeeping and for tests asserting it stays comfortably under the 700ms budget. */
export function cabinTransitionTotalMs(reducedMotion: boolean): number {
	return reducedMotion
		? REDUCED_MOTION_FADE_MS * 2
		: CABIN_FADE_MS * 2 + CABIN_HOLD_MS;
}

/** Total time the Pokemon-battle-intro overlay plays for, before EncounterBanner (already mounted underneath it) is the only thing left on screen. */
export function encounterIntroTotalMs(reducedMotion: boolean): number {
	return reducedMotion
		? REDUCED_MOTION_FADE_MS
		: ENCOUNTER_FLASH_MS + ENCOUNTER_WIPE_MS + ENCOUNTER_REVEAL_MS;
}

/** Total time the file-portal wipe overlay plays for (same duration entering or leaving — the wipe is symmetric, only its color emphasis differs). */
export function portalTransitionTotalMs(reducedMotion: boolean): number {
	return reducedMotion ? REDUCED_MOTION_FADE_MS : PORTAL_WIPE_MS;
}

/** How long WorldScene waits after announcing a layer switch before restarting — the pulse's rise, so the cut lands under it. */
export function layerTransitionDelayMs(reducedMotion: boolean): number {
	return reducedMotion ? REDUCED_MOTION_FADE_MS : LAYER_PULSE_IN_MS;
}

export function layerTransitionTotalMs(reducedMotion: boolean): number {
	return reducedMotion
		? REDUCED_MOTION_FADE_MS * 2
		: LAYER_PULSE_IN_MS + LAYER_PULSE_OUT_MS;
}

/** Rise/sink time for a layer's objects: none under reduced motion (they just appear or go). */
export function layerRiseMs(reducedMotion: boolean): number {
	return reducedMotion ? 0 : LAYER_RISE_MS;
}

/** Every transition kind this milestone ships, keyed the same way SceneTransitionOverlay.tsx names its play state. */
export type SceneTransitionKind = "cabin" | "encounter" | "portal" | "layer";

/** Single lookup used by both the scene code (to size a delay) and the overlay (to size a CSS animation), so "how long does kind X take" is asked in exactly one place. */
export function sceneTransitionTotalMs(
	kind: SceneTransitionKind,
	reducedMotion: boolean,
): number {
	switch (kind) {
		case "cabin":
			return cabinTransitionTotalMs(reducedMotion);
		case "encounter":
			return encounterIntroTotalMs(reducedMotion);
		case "portal":
			return portalTransitionTotalMs(reducedMotion);
		case "layer":
			return layerTransitionTotalMs(reducedMotion);
	}
}
