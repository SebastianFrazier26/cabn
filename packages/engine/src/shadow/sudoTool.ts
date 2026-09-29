import { uiIconPath } from "../assetPaths.js";
import type { Tool } from "../systems/tools.js";

/**
 * The owner's "sudo" item: toggles the current world into the shadow realm
 * and back (like `ls` vs `ls -a`). Borrows the opener's key icon, hue-shifted
 * by the hotbar, until M3 draws its own.
 */
export function createSudoTool(layerId: string): Tool {
	return {
		id: "sudo",
		label: "Sudo",
		name: "Sudo (hidden files)",
		icon: uiIconPath("key"),
		hotkey: "H",
		onUse: (ctx) => ctx.bus.emit("layer:toggle", { layerId }),
	};
}
