import type { TimeOfDayOverride } from "./timeOfDay.js";

const TIME_OF_DAY_STORAGE_KEY = "cabn:time-of-day-override";

// Same missing-global guard as save.ts's hasLocalStorage — SSR/non-browser
// test runners have no `localStorage` at all.
function hasLocalStorage(): boolean {
	return typeof localStorage !== "undefined";
}

/** Returns null (not "auto") when there's no stored preference yet, so the caller can tell "unset" apart from an explicit choice of auto. Same try/catch-and-ignore shape as save.ts's loadSave. */
export function loadTimeOfDayOverride(): TimeOfDayOverride | null {
	if (!hasLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(TIME_OF_DAY_STORAGE_KEY);
		if (raw === "auto" || raw === "day" || raw === "night") return raw;
		return null;
	} catch {
		return null;
	}
}

export function persistTimeOfDayOverride(override: TimeOfDayOverride): void {
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(TIME_OF_DAY_STORAGE_KEY, override);
	} catch {
		// Ignore, don't break the game — same reasoning as save.ts.
	}
}
