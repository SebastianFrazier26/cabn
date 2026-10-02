import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCabnBus } from "../src/bridge/events.js";
import { createCabnStore } from "../src/bridge/store.js";
import {
	LOADING_MIN_VISIBLE_MS,
	LOADING_SHOW_DELAY_MS,
} from "../src/systems/loadingScreen.js";
import {
	RETURN_TO_SHELF_LABEL,
	SceneLoadCoordinator,
} from "../src/systems/sceneLoading.js";
import {
	CABIN_FADE_MS,
	LAYER_PULSE_IN_MS,
	sceneTransitionTotalMs,
	transitionCoverTiming,
} from "../src/systems/sceneTransition.js";

function setup() {
	const store = createCabnStore();
	const bus = createCabnBus();
	const coordinator = new SceneLoadCoordinator(store, bus, () => false);
	const detach = coordinator.attach();
	return { store, bus, coordinator, detach };
}

describe("SceneLoadCoordinator", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("labels a cabin entry with the world's name and adds the fade to the delay", () => {
		const { store, bus, coordinator } = setup();
		bus.emit("shelf:enter-world", { worldId: "notes", name: "notes-vault" });
		expect(store.getState().loading).toMatchObject({
			active: true,
			label: "Walking to notes-vault…",
		});
		vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS + CABIN_FADE_MS - 1);
		expect(store.getState().loading.visible).toBe(false);
		vi.advanceTimersByTime(1);
		expect(store.getState().loading.visible).toBe(true);
		coordinator.settled();
		vi.advanceTimersByTime(LOADING_MIN_VISIBLE_MS);
		expect(store.getState().loading.visible).toBe(false);
	});

	it("labels the shelf, a universe, home and a layer", () => {
		const { store, bus } = setup();
		bus.emit("world:return-to-shelf", { shelfUrl: "/s.json" });
		expect(store.getState().loading.label).toBe(RETURN_TO_SHELF_LABEL);
		bus.emit("universe:travel", {
			worldUrl: "x",
			universe: { slug: "dev", branch: "feature/dev" },
		});
		expect(store.getState().loading.label).toBe(
			"Opening the rift to feature/dev…",
		);
		bus.emit("universe:travel", { worldUrl: "x", universe: null });
		expect(store.getState().loading.label).toBe(
			"Stepping home through the rift…",
		);
		bus.emit("layer:changed", { layerId: "shadow", color: null });
		expect(store.getState().loading.label).toBe("Revealing the shadow layer…");
		bus.emit("layer:changed", { layerId: null, color: null });
		expect(store.getState().loading.label).toBe(
			"Stepping back into the world…",
		);
	});

	it("a layer restart's delay adds the pulse's rise", () => {
		const { store, bus } = setup();
		bus.emit("layer:changed", { layerId: null, color: null });
		vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS + LAYER_PULSE_IN_MS - 1);
		expect(store.getState().loading.visible).toBe(false);
		vi.advanceTimersByTime(1);
		expect(store.getState().loading.visible).toBe(true);
	});

	it("hands one scene load over to the next without the panel dropping out", () => {
		const { store, bus, coordinator } = setup();
		const seen: boolean[] = [];
		store.subscribe((s) => seen.push(s.loading.active));
		coordinator.expect("first");
		bus.emit("world:return-to-shelf", { shelfUrl: "/s.json" });
		expect(seen.includes(false)).toBe(false);
		coordinator.settled();
		expect(store.getState().loading.active).toBe(false);
	});

	it("a universe conversion's own token and the travel it triggers overlap cleanly", () => {
		const { store, bus, coordinator } = setup();
		const conversion = store.getState().beginLoading("Opening the rift to x…");
		vi.advanceTimersByTime(LOADING_SHOW_DELAY_MS);
		expect(store.getState().loading.visible).toBe(true);
		bus.emit("universe:travel", {
			worldUrl: "x",
			universe: { slug: "x", branch: "x" },
		});
		store.getState().endLoading(conversion);
		vi.advanceTimersByTime(5_000);
		expect(store.getState().loading.visible).toBe(true);
		coordinator.settled();
		vi.advanceTimersByTime(LOADING_MIN_VISIBLE_MS);
		expect(store.getState().loading.visible).toBe(false);
	});

	it("settled with nothing pending is a no-op, and doesn't end someone else's load", () => {
		const { store, coordinator } = setup();
		const other = store.getState().beginLoading("pensieve");
		coordinator.settled();
		expect(store.getState().loading.active).toBe(true);
		store.getState().endLoading(other);
	});

	it("fail shows the error; retry and back clear it and begin a visible load at once", () => {
		const { store, coordinator } = setup();
		coordinator.expect("Walking to notes…");
		const retry = vi.fn();
		const back = vi.fn();
		coordinator.fail({ message: "washed out", retry, back });
		const error = store.getState().loading.error;
		expect(error?.message).toBe("washed out");
		expect(coordinator.pending).toBe(false);

		error?.retry?.();
		expect(retry).toHaveBeenCalledOnce();
		expect(store.getState().loading).toMatchObject({
			error: null,
			visible: true,
			label: "Walking to notes…",
		});

		coordinator.fail({ message: "again", back });
		store.getState().loading.error?.back?.();
		expect(back).toHaveBeenCalledOnce();
		expect(store.getState().loading).toMatchObject({
			error: null,
			visible: true,
			label: RETURN_TO_SHELF_LABEL,
		});
		coordinator.settled();
	});

	it("detach stops listening and ends its load", () => {
		const { store, bus, detach } = setup();
		bus.emit("world:return-to-shelf", { shelfUrl: "/s.json" });
		detach();
		expect(store.getState().loading.active).toBe(false);
		bus.emit("world:return-to-shelf", { shelfUrl: "/s.json" });
		expect(store.getState().loading.active).toBe(false);
	});
});

describe("transitionCoverTiming", () => {
	it("adds up to the unsplit transition length when nothing is loading", () => {
		for (const kind of ["cabin", "layer"] as const)
			for (const reduced of [false, true]) {
				const t = transitionCoverTiming(kind, reduced);
				expect(t.coverMs + t.holdMs + t.revealMs).toBe(
					sceneTransitionTotalMs(kind, reduced),
				);
			}
	});
});
