import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCabnStore } from "../src/bridge/store.js";
import {
	LOADING_MIN_VISIBLE_MS,
	LOADING_SHOW_DELAY_MS,
	type LoadingClock,
	type LoadingState,
	LoadingTracker,
	loadingTips,
} from "../src/systems/loadingScreen.js";

/** A hand-cranked clock: `advance` fires due timers in order, like the real event loop would. */
function manualClock() {
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const clock: LoadingClock = {
		now: () => now,
		setTimeout: (fn, ms) => {
			const id = nextId++;
			timers.set(id, { at: now + ms, fn });
			return id;
		},
		clearTimeout: (id) => {
			timers.delete(id as number);
		},
	};
	const advance = (ms: number) => {
		const until = now + ms;
		for (;;) {
			let due: [number, { at: number; fn: () => void }] | null = null;
			for (const entry of timers)
				if (entry[1].at <= until && (!due || entry[1].at < due[1].at))
					due = entry;
			if (!due) break;
			timers.delete(due[0]);
			now = due[1].at;
			due[1].fn();
		}
		now = until;
	};
	return { clock, advance, pending: () => timers.size };
}

function setup() {
	const { clock, advance, pending } = manualClock();
	const changes: LoadingState[] = [];
	const tracker = new LoadingTracker((s) => changes.push(s), clock);
	return { tracker, advance, pending, changes };
}

describe("LoadingTracker", () => {
	it("uses the reviewed thresholds (2026-09-30): show after 500 ms, stay at least 250 ms", () => {
		expect(LOADING_SHOW_DELAY_MS).toBe(500);
		expect(LOADING_MIN_VISIBLE_MS).toBe(250);
	});

	it("never shows a load that ends before the delay", () => {
		const { tracker, advance, changes, pending } = setup();
		const t = tracker.begin("Walking to notes…");
		expect(tracker.state).toMatchObject({ active: true, visible: false });
		advance(LOADING_SHOW_DELAY_MS - 1);
		tracker.end(t);
		advance(5_000);
		expect(changes.some((s) => s.visible)).toBe(false);
		expect(tracker.state.active).toBe(false);
		expect(pending()).toBe(0);
	});

	it("shows after the delay with the label, and stays at least the minimum time", () => {
		const { tracker, advance } = setup();
		const t = tracker.begin("Waking the cabin…");
		advance(LOADING_SHOW_DELAY_MS);
		expect(tracker.state).toMatchObject({
			active: true,
			visible: true,
			label: "Waking the cabin…",
		});
		advance(10);
		tracker.end(t);
		// Ended, but still on screen until the minimum has passed.
		expect(tracker.state).toMatchObject({ active: false, visible: true });
		expect(tracker.state.label).toBe("Waking the cabin…");
		advance(LOADING_MIN_VISIBLE_MS - 11);
		expect(tracker.state.visible).toBe(true);
		advance(1);
		expect(tracker.state.visible).toBe(false);
	});

	it("hides at once when the load already outlasted the minimum", () => {
		const { tracker, advance } = setup();
		const t = tracker.begin("x");
		advance(LOADING_SHOW_DELAY_MS + LOADING_MIN_VISIBLE_MS + 50);
		tracker.end(t);
		expect(tracker.state.visible).toBe(false);
	});

	it("honours a per-load delay (a load that starts under a fade)", () => {
		const { tracker, advance } = setup();
		tracker.begin("x", { delayMs: 520 });
		advance(519);
		expect(tracker.state.visible).toBe(false);
		advance(1);
		expect(tracker.state.visible).toBe(true);
	});

	it("keeps overlapping loads apart: ending one never ends the other", () => {
		const { tracker, advance } = setup();
		const a = tracker.begin("Opening the rift to dev…");
		advance(100);
		const b = tracker.begin("Walking to dev…");
		expect(tracker.state.label).toBe("Walking to dev…");
		tracker.end(a);
		expect(tracker.state.active).toBe(true);
		// With a gone, b's own delay (from t=100) decides when the panel shows.
		advance(LOADING_SHOW_DELAY_MS - 1);
		expect(tracker.state.visible).toBe(false);
		advance(1);
		expect(tracker.state.visible).toBe(true);
		tracker.end(a);
		expect(tracker.state.active).toBe(true);
		tracker.end(b);
		expect(tracker.state.active).toBe(false);
	});

	it("shows the most recent open load's label, and falls back when it ends", () => {
		const { tracker } = setup();
		const a = tracker.begin("first");
		const b = tracker.begin("second");
		expect(tracker.state.label).toBe("second");
		tracker.end(b);
		expect(tracker.state.label).toBe("first");
		tracker.end(a);
	});

	it("does not flicker when a new load begins while the last one lingers", () => {
		const { tracker, advance, changes } = setup();
		const a = tracker.begin("a");
		advance(LOADING_SHOW_DELAY_MS);
		tracker.end(a);
		advance(100);
		const b = tracker.begin("b");
		advance(LOADING_MIN_VISIBLE_MS);
		const visibility = changes.map((s) => s.visible);
		expect(visibility.indexOf(false, visibility.indexOf(true))).toBe(-1);
		tracker.end(b);
		expect(tracker.state.visible).toBe(false);
	});

	it("clamps progress, ignores unknown tokens, and fills the bar while lingering", () => {
		const { tracker, advance } = setup();
		const t = tracker.begin("x");
		tracker.setProgress(t, 1.7);
		expect(tracker.state.progress).toBe(1);
		tracker.setProgress(t, -1, "art");
		expect(tracker.state).toMatchObject({ progress: 0, detail: "art" });
		tracker.setProgress(t, 0.4);
		tracker.setProgress(999, 0.9);
		expect(tracker.state.progress).toBe(0.4);
		advance(LOADING_SHOW_DELAY_MS);
		tracker.end(t);
		expect(tracker.state).toMatchObject({ visible: true, progress: 1 });
	});

	it("puts an error up at once and keeps it until cleared", () => {
		const { tracker, advance } = setup();
		const t = tracker.begin("Walking to notes…");
		const retry = vi.fn();
		tracker.fail(t, { message: "The path has washed out.", retry });
		expect(tracker.state).toMatchObject({
			active: false,
			visible: true,
			error: { message: "The path has washed out." },
		});
		advance(60_000);
		expect(tracker.state.visible).toBe(true);
		tracker.clearError();
		expect(tracker.state).toMatchObject({ visible: false, error: null });
	});

	it("an error outranks a load still open behind it; clearing it shows that load", () => {
		const { tracker } = setup();
		const a = tracker.begin("a");
		const b = tracker.begin("b");
		tracker.fail(b, { message: "nope" });
		expect(tracker.state.error?.message).toBe("nope");
		expect(tracker.state.active).toBe(true);
		tracker.clearError();
		expect(tracker.state).toMatchObject({ visible: true, label: "a" });
		tracker.end(a);
	});

	it("failing an ended token does nothing", () => {
		const { tracker } = setup();
		const t = tracker.begin("x");
		tracker.end(t);
		tracker.fail(t, { message: "late" });
		expect(tracker.state.error).toBeNull();
	});
});

describe("store loading actions", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("drive state.loading through the tracker", () => {
		const store = createCabnStore();
		expect(store.getState().loading.active).toBe(false);
		const t = store.getState().beginLoading("Walking to notes…");
		expect(store.getState().loading).toMatchObject({
			active: true,
			visible: false,
		});
		vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS);
		expect(store.getState().loading.visible).toBe(true);
		store.getState().setLoadingProgress(t, 0.5);
		expect(store.getState().loading.progress).toBe(0.5);
		store.getState().endLoading(t);
		vi.advanceTimersByTime(LOADING_MIN_VISIBLE_MS);
		expect(store.getState().loading).toMatchObject({
			active: false,
			visible: false,
		});
		const u = store.getState().beginLoading("again");
		store.getState().failLoading(u, { message: "torn" });
		expect(store.getState().loading.error?.message).toBe("torn");
		store.getState().clearLoadingError();
		expect(store.getState().loading.visible).toBe(false);
	});
});

describe("loadingTips", () => {
	it("are Wren's own single-line pages, short enough for the panel", () => {
		const tips = loadingTips();
		expect(tips.length).toBeGreaterThan(8);
		for (const tip of tips) {
			expect(tip).not.toContain("\n");
			expect(tip.length).toBeLessThanOrEqual(170);
		}
	});
});
