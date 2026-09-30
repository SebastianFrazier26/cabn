import type { CabnBus, CabnEvents } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { LOADING_SHOW_DELAY_MS, type LoadingToken } from "./loadingScreen.js";
import {
	cabinTransitionDelayMs,
	layerTransitionDelayMs,
} from "./sceneTransition.js";

type LoadingActions = Pick<
	CabnStore,
	| "beginLoading"
	| "setLoadingProgress"
	| "endLoading"
	| "failLoading"
	| "clearLoadingError"
	| "worldLayers"
>;

export interface SceneLoadStore {
	getState(): LoadingActions;
}

export interface SceneLoadFailure {
	message: string;
	detail?: string;
	retry?: () => void;
	back?: () => void;
	backLabel?: string;
}

/** Where game.ts puts the coordinator in the Phaser registry, beside the store and bus. */
export const SCENE_LOADING_REGISTRY_KEY = "sceneLoading";

export const STARTUP_SHELF_LABEL = "Waking the cabin…";
export const STARTUP_WORLD_LABEL = "Walking into the world…";
export const RETURN_TO_SHELF_LABEL = "Walking back to the shelf…";

export function enterWorldLabel(name: string | undefined): string {
	return name ? `Walking to ${name}…` : STARTUP_WORLD_LABEL;
}

export function travelLabel(
	universe: CabnEvents["universe:travel"]["universe"],
): string {
	return universe
		? `Opening the rift to ${universe.branch}…`
		: "Stepping home through the rift…";
}

export function layerLabel(layerLabel: string | null): string {
	return layerLabel
		? `Revealing the ${layerLabel} layer…`
		: "Stepping back into the world…";
}

/**
 * The one scene load in flight (startup, a cabin, the shelf, a universe, a
 * layer restart): begun the moment the bus announces it, ended when the
 * world or shelf scene has created — game.ts calls settled() from those
 * scenes' CREATE events, so WorldScene/ShelfScene need no loading code of
 * their own. The show delay for a bus-announced
 * load adds the transition's own fade-out, because the scene doesn't even
 * start loading until that fade has covered the screen.
 */
export class SceneLoadCoordinator {
	private token: LoadingToken | null = null;
	private label = "";

	constructor(
		private readonly store: SceneLoadStore,
		private readonly bus: CabnBus,
		private readonly reducedMotion: () => boolean,
	) {}

	get pending(): boolean {
		return this.token !== null;
	}

	attach(): () => void {
		const onEnterWorld = ({ name }: CabnEvents["shelf:enter-world"]) =>
			this.expect(enterWorldLabel(name), this.cabinDelay());
		const onReturn = () =>
			this.expect(RETURN_TO_SHELF_LABEL, this.cabinDelay());
		const onTravel = ({ universe }: CabnEvents["universe:travel"]) =>
			this.expect(travelLabel(universe), this.cabinDelay());
		const onLayer = ({ layerId }: CabnEvents["layer:changed"]) => {
			const provider = this.store
				.getState()
				.worldLayers.find((l) => l.id === layerId);
			this.expect(
				layerLabel(layerId === null ? null : (provider?.label ?? layerId)),
				LOADING_SHOW_DELAY_MS + layerTransitionDelayMs(this.reducedMotion()),
			);
		};
		this.bus.on("shelf:enter-world", onEnterWorld);
		this.bus.on("world:return-to-shelf", onReturn);
		this.bus.on("universe:travel", onTravel);
		this.bus.on("layer:changed", onLayer);
		return () => {
			this.bus.off("shelf:enter-world", onEnterWorld);
			this.bus.off("world:return-to-shelf", onReturn);
			this.bus.off("universe:travel", onTravel);
			this.bus.off("layer:changed", onLayer);
			this.settled();
		};
	}

	/** Begins the new load before ending any previous one, so the overlay never drops out between them. */
	expect(label: string, delayMs = LOADING_SHOW_DELAY_MS): void {
		const previous = this.token;
		this.label = label;
		this.token = this.store.getState().beginLoading(label, { delayMs });
		if (previous !== null) this.store.getState().endLoading(previous);
	}

	progress(progress: number | null, detail?: string | null): void {
		if (this.token !== null)
			this.store.getState().setLoadingProgress(this.token, progress, detail);
	}

	settled(): void {
		if (this.token === null) return;
		const token = this.token;
		this.token = null;
		this.store.getState().endLoading(token);
	}

	/**
	 * Puts the error up in place of the panel. Retry reuses the failed load's
	 * label; both ways out show their panel at once (delay 0), since behind
	 * the error there is no scene left to look at.
	 */
	fail(failure: SceneLoadFailure): void {
		if (this.token === null) this.expect(this.label || STARTUP_WORLD_LABEL, 0);
		const token = this.token as LoadingToken;
		this.token = null;
		const label = this.label;
		const state = this.store.getState();
		const { retry, back } = failure;
		state.failLoading(token, {
			message: failure.message,
			...(failure.detail ? { detail: failure.detail } : {}),
			...(failure.backLabel ? { backLabel: failure.backLabel } : {}),
			...(retry
				? {
						retry: () => {
							this.store.getState().clearLoadingError();
							this.expect(label, 0);
							retry();
						},
					}
				: {}),
			...(back
				? {
						back: () => {
							this.store.getState().clearLoadingError();
							this.expect(RETURN_TO_SHELF_LABEL, 0);
							back();
						},
					}
				: {}),
		});
	}

	private cabinDelay(): number {
		return LOADING_SHOW_DELAY_MS + cabinTransitionDelayMs(this.reducedMotion());
	}
}
