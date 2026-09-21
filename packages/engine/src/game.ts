import Phaser from "phaser";
import { createCabnBus } from "./bridge/events.js";
import { createCabnStore } from "./bridge/store.js";
import type { BootSceneData } from "./scenes/BootScene.js";
import { BootScene } from "./scenes/BootScene.js";
import { PreloadScene } from "./scenes/PreloadScene.js";
import { ShelfScene } from "./scenes/ShelfScene.js";
import { WorldScene } from "./scenes/WorldScene.js";

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
		scene: [BootScene, PreloadScene, WorldScene, ShelfScene],
	});

	game.registry.set("store", store);
	game.registry.set("bus", bus);
	game.scene.start("boot", target);

	return { game, store, bus };
}
