/**
 * When the one live arch iframe mounts and unmounts. Pure so the timing is
 * testable; WorldScene feeds it once per frame and mirrors `mounted` into
 * the store.
 */

/** Mount radius for the live page; also what "nearest arch" is measured against. */
export const HERO_MOUNT_RADIUS = 150;

/**
 * Release radius = 1.6x the mount radius. A live site is a full page load, so
 * brushing past an arch must not tear it down: the player has to get clearly
 * away, not just step off the mount edge.
 */
export const HERO_RELEASE_RADIUS = HERO_MOUNT_RADIUS * 1.6;

/** Beyond the release radius the iframe survives this long, so turning back keeps the loaded page instead of reloading it (3-5 reloads per 80 s walk before). */
export const HERO_UNMOUNT_DELAY_MS = 4000;

/**
 * After world create-end, wait for idle (or this timeout) before the first
 * mount. The player spawns inside the radius and the iframe's load competes
 * with the heavy first ground/path bakes for the main thread.
 */
export const HERO_IDLE_TIMEOUT_MS = 1500;

export interface HeroMountState {
	mounted: string | null;
	/** `now` when the held arch first fell outside the release radius; null while inside it. */
	outsideSince: number | null;
}

export interface HeroMountInput {
	now: number;
	/** World entry finished and the idle gate passed. */
	ready: boolean;
	/** Nearest url arch within HERO_MOUNT_RADIUS, if any. */
	nearest: string | null;
	/** Player distance to the currently mounted arch; null when it is gone or unplaceable. */
	heldDistance: number | null;
}

export const INITIAL_HERO_MOUNT: HeroMountState = {
	mounted: null,
	outsideSince: null,
};

export function stepHeroMount(
	state: HeroMountState,
	input: HeroMountInput,
): HeroMountState {
	if (!input.ready) return INITIAL_HERO_MOUNT;
	if (input.nearest !== null) {
		if (state.mounted === input.nearest && state.outsideSince === null)
			return state;
		return { mounted: input.nearest, outsideSince: null };
	}
	if (state.mounted === null) return state;
	if (input.heldDistance === null) return INITIAL_HERO_MOUNT;
	if (input.heldDistance <= HERO_RELEASE_RADIUS)
		return state.outsideSince === null
			? state
			: { mounted: state.mounted, outsideSince: null };
	const since = state.outsideSince ?? input.now;
	if (input.now - since >= HERO_UNMOUNT_DELAY_MS) return INITIAL_HERO_MOUNT;
	return state.outsideSince === null
		? { mounted: state.mounted, outsideSince: since }
		: state;
}
