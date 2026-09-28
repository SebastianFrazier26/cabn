import Phaser from "phaser";
import { activeFocusOwner } from "../systems/uiFocus.js";

/**
 * Hands the whole keyboard to a focused text field (the orb's search input,
 * the spellbook's CodeMirror editor) and back again, checked once per game
 * step. Phaser's KeyboardManager listens on `window` and preventDefault()s
 * every key a scene has addKey()'d — so without this, typing "w" or "e" into
 * the search box was swallowed and walked the player instead, and Enter or
 * Esc typed there also fired world interaction / leave-file. Disabling the
 * manager (not each scene's plugin) is what skips both the event queue and
 * the preventDefault, and leaves FileScene's own per-mode plugin toggle
 * alone. Polling document.activeElement rather than listening for
 * focusin/focusout also covers a focused element being removed from the DOM
 * (closing the search), which doesn't reliably fire focusout.
 */
export function attachKeyboardFocusGate(game: Phaser.Game): () => void {
	let textFocused = false;
	const onPreStep = (): void => {
		const manager = game.input.keyboard;
		if (!manager) return;
		const next = activeFocusOwner() === "text";
		if (next === textFocused) return;
		textFocused = next;
		manager.enabled = !next;
		// Keys already held when focus moved never see their keyup while the
		// manager is off; without a reset they'd read as stuck-down afterwards.
		if (next) {
			for (const scene of game.scene.getScenes(false)) {
				scene.input?.keyboard?.resetKeys();
			}
		}
	};
	game.events.on(Phaser.Core.Events.PRE_STEP, onPreStep);
	return () => game.events.off(Phaser.Core.Events.PRE_STEP, onPreStep);
}
