import Phaser from "phaser";
import { createCabnBus } from "./bridge/events.js";
import { createCabnStore } from "./bridge/store.js";
import { attachKeyboardFocusGate } from "./render/keyboardFocusGate.js";
import type { BootSceneData } from "./scenes/BootScene.js";
import { BootScene } from "./scenes/BootScene.js";
import { FileScene } from "./scenes/FileScene.js";
import { PreloadScene } from "./scenes/PreloadScene.js";
import { ShelfScene } from "./scenes/ShelfScene.js";
import { WorldScene } from "./scenes/WorldScene.js";
import { loadTimeOfDayOverride } from "./systems/timeOfDaySettings.js";

/** How often "auto" re-checks the clock — frequent enough that a session left open actually crosses the day/night boundary live, cheap enough (one Date + a couple of comparisons) that it's not worth gating behind anything fancier. */
const TIME_OF_DAY_REFRESH_MS = 60_000;

export interface CabnGameHandle {
	game: Phaser.Game;
	store: ReturnType<typeof createCabnStore>;
	bus: ReturnType<typeof createCabnBus>;
}

/** Boot straight into a single world, or into the shelf hub listing many. */
export type CabnGameTarget = BootSceneData;

/**
 * Store/bus live in game.registry rather than being threaded through every
 * scene.start() payload — they're cross-cutting singletons for this game
 * instance, not per-scene data (see bridge/events.ts for the state-vs-event
 * split scenes are expected to respect).
 */
export function createCabnGame(
	parent: HTMLElement,
	target: CabnGameTarget,
): CabnGameHandle {
	const store = createCabnStore();
	const bus = createCabnBus();
	store.getState().setTimeOfDayOverride(loadTimeOfDayOverride() ?? "auto");
	const timeOfDayInterval = setInterval(
		() => store.getState().refreshTimeOfDay(),
		TIME_OF_DAY_REFRESH_MS,
	);
	// A backgrounded tab's timers are throttled/paused by the browser, so the
	// 60s interval above can't be trusted to have fired the instant a session
	// left open overnight regains focus — re-resolving on visibilitychange
	// (not "focus", which also fires for e.g. window-manager alt-tab cycling
	// that never actually hid the tab) makes the theme flip land the moment
	// the tab becomes visible again instead of up to 60s later.
	const onVisibilityChange = () => {
		if (document.visibilityState === "visible") {
			store.getState().refreshTimeOfDay();
		}
	};
	document.addEventListener("visibilitychange", onVisibilityChange);

	const game = new Phaser.Game({
		type: Phaser.AUTO,
		parent,
		width: parent.clientWidth || 800,
		height: parent.clientHeight || 600,
		pixelArt: true,
		roundPixels: true,
		backgroundColor: "#1f2a17",
		physics: {
			default: "arcade",
			arcade: { gravity: { x: 0, y: 0 }, debug: false },
		},
		scale: {
			mode: Phaser.Scale.RESIZE,
			parent,
		},
		// Each scene declares `active: false` in its own constructor (see
		// BootScene et al.) so none of them auto-start — "boot" is kicked off
		// explicitly below, once the target is available to pass as init data.
		scene: [BootScene, PreloadScene, WorldScene, ShelfScene, FileScene],
	});

	game.registry.set("store", store);
	game.registry.set("bus", bus);
	const detachKeyboardFocusGate = attachKeyboardFocusGate(game);
	game.events.once(Phaser.Core.Events.DESTROY, () => {
		detachKeyboardFocusGate();
		clearInterval(timeOfDayInterval);
		document.removeEventListener("visibilitychange", onVisibilityChange);
	});
	game.scene.start("boot", target);

	return { game, store, bus };
}
