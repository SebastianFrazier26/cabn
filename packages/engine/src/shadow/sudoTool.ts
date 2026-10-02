import type { LayerTool } from "../systems/worldLayer.js";
import { SUDO_ICON_PATH } from "./assets.js";

/**
 * The owner's "sudo" item: toggles the current world into the shadow realm
 * and back (like `ls` vs `ls -a`). It lives in the owner's toolkit (O), so it
 * has no hotkey of its own.
 */
export function createSudoTool(layerId: string): LayerTool {
	return {
		id: "sudo",
		label: "Sudo",
		name: "Sudo (hidden files)",
		icon: SUDO_ICON_PATH,
		onUse: (ctx) => ctx.bus.emit("layer:toggle", { layerId }),
	};
}
