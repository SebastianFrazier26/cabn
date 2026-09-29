/**
 * `performance.mark`/`measure` wrappers gated on `?perf=1` — a perf-measurement
 * session's own driver script reads these back through the Performance
 * Timeline (`performance.getEntriesByType`), not console output, so it can
 * turn "shelf → world entry" into a named breakdown (ground bake, path bake,
 * portals, monsters, ...) without re-instrumenting the DOM for every run.
 * The URLSearchParams check happens once at module load; every call site
 * after that is a single boolean check, so this is zero-cost for every real
 * player who never adds `?perf=1` to the URL.
 */
const enabled =
	typeof window !== "undefined" &&
	new URLSearchParams(window.location.search).get("perf") === "1";

export const perfMarksEnabled = enabled;

export function perfMark(name: string): void {
	if (enabled) performance.mark(name);
}

/** Best-effort: a measure between two marks that didn't both fire (an optional phase this run skipped) should never throw and abort the scene it's timing. */
export function perfMeasure(
	name: string,
	startMark: string,
	endMark: string,
): void {
	if (!enabled) return;
	try {
		performance.measure(name, startMark, endMark);
	} catch {
		// one of the marks is missing — this run's shape skipped that phase.
	}
}
