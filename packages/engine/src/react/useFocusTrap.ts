import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

function focusable(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
	).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Keeps Tab/Shift+Tab cycling inside `containerRef` and restores whatever had
 * focus before it opened, once it closes (or `active` turns false). Every
 * modal panel here (Guide, Orb, Pensieve, sign reader, rift, ...) already
 * runs its own window-capture keydown listener for Escape/Enter, but none of
 * them intercept Tab — this is the one thing missing from that pattern, not
 * a replacement for it, so it's a separate hook rather than folded into each
 * panel's own handler.
 *
 * `active` defaults to true for the common case (a panel that's its own
 * component, mounted only while open, e.g. GuideDialogBox/PensievePanel) —
 * there the effect's mount/cleanup already lines up with open/close. Panels
 * that stay mounted and toggle their own dialog output instead (SignReader,
 * SignPlacingBanner) must pass the open flag explicitly, since a ref object
 * never changes identity and a dep array of just `[containerRef]` would only
 * ever fire once, before the dialog's own subtree (and its ref) existed.
 */
export function useFocusTrap(
	containerRef: React.RefObject<HTMLElement | null>,
	active = true,
): void {
	const restoreRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!active) return;
		const container = containerRef.current;
		if (!container) return;
		restoreRef.current =
			document.activeElement instanceof HTMLElement &&
			document.activeElement !== document.body
				? document.activeElement
				: null;

		if (!container.contains(document.activeElement)) {
			(focusable(container)[0] ?? container).focus({ preventScroll: true });
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			// Re-read containerRef.current rather than closing over `container`:
			// a few callers (OrbSearch, SpyglassPanel) remount their dialog's own
			// subtree under a `key` while staying "active" the whole time, to
			// retrigger a CSS open animation — `container` above would otherwise
			// go stale, pointing at an already-detached node.
			const live = containerRef.current;
			if (!live) return;
			const items = focusable(live);
			if (items.length === 0) {
				event.preventDefault();
				return;
			}
			const first = items[0] as HTMLElement;
			const last = items[items.length - 1] as HTMLElement;
			const activeEl = document.activeElement;
			if (event.shiftKey) {
				if (activeEl === first || !live.contains(activeEl)) {
					event.preventDefault();
					last.focus();
				}
			} else if (activeEl === last || !live.contains(activeEl)) {
				event.preventDefault();
				first.focus();
			}
		};
		// Capture, same as every panel's own Escape listener — it must see Tab
		// before Phaser's own window keydown listener would otherwise ignore it.
		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			const toRestore = restoreRef.current;
			if (toRestore?.isConnected) toRestore.focus({ preventScroll: true });
		};
	}, [containerRef, active]);
}
