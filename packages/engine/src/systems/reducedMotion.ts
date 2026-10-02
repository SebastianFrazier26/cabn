/** `window.matchMedia` is undefined under Vitest's default (non-jsdom) environment and in any non-browser host — treated as "no preference" rather than throwing. Gates real animation only (ambient particles, tweens, scene fades); the glow post-effect is a static bloom, not motion, so it deliberately doesn't read this. */
export function prefersReducedMotion(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
