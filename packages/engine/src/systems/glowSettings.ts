const GLOW_STORAGE_KEY = "cabn:glow-enabled";

/** Pure: default is on, unless the platform says the player wants less motion — same reasoning as any other reduced-motion gate, kept separate from the localStorage override below so it's testable without a DOM. */
export function defaultGlowEnabled(prefersReducedMotion: boolean): boolean {
	return !prefersReducedMotion;
}

/** `window.matchMedia` is undefined under Vitest's default (non-jsdom) environment and in any non-browser host — treated as "no preference" rather than throwing. */
export function prefersReducedMotion(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Same missing-global guard as save.ts's hasLocalStorage — SSR/non-browser test runners have no `localStorage` at all, not just a throwing one. */
function hasLocalStorage(): boolean {
	return typeof localStorage !== "undefined";
}

/** Returns null (not a boolean) when there's no stored preference yet, so the caller can fall back to defaultGlowEnabled() instead of treating "unset" as "off". Same try/catch-and-ignore shape as save.ts's loadSave — a disabled/unavailable localStorage (private browsing, SSR) degrades to "no preference" rather than breaking the game. */
export function loadGlowEnabled(): boolean | null {
	if (!hasLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(GLOW_STORAGE_KEY);
		if (raw === "1") return true;
		if (raw === "0") return false;
		return null;
	} catch {
		return null;
	}
}

export function persistGlowEnabled(enabled: boolean): void {
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(GLOW_STORAGE_KEY, enabled ? "1" : "0");
	} catch {
		// Same "ignore, don't break the game" shape as save.ts's persistSave.
	}
}
