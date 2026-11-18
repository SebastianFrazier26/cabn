/** The slice of Phaser's Key this needs: its emitter, which fires "down" from the same keyboard-queue pass that later processes "up". */
export interface DownEmitter {
	on(event: "down", fn: () => void): unknown;
}

/**
 * A press that survives a key-up landing in the same frame. Phaser's
 * `Keyboard.JustDown` reads a flag that `Key.onUp` clears, and the plugin
 * drains its queue once per game step — so on a slow frame a quick tap
 * (down and up both queued) reads as no press at all. 2026-11-18: on CI's
 * software GL that dropped the spellbook spec's Enter. Latching at "down"
 * keeps the press until a scene consumes it.
 */
export class PressLatch {
	private pressed = false;

	constructor(key: DownEmitter) {
		key.on("down", () => {
			this.pressed = true;
		});
	}

	/** True once per press, whether or not the key is still held. */
	consume(): boolean {
		const was = this.pressed;
		this.pressed = false;
		return was;
	}
}
