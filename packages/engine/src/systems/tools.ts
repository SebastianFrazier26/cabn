import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";

export interface ToolContext {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

export interface Tool {
	id: string;
	name: string;
	/** Asset path (React <img src>) for the hotbar slot icon. */
	icon: string;
	/** Display + lookup key, e.g. "E", "L", "Cmd/Ctrl+F". */
	hotkey: string;
	onUse(ctx: ToolContext): void;
}

/**
 * Registration order is preserved for `list()` (hotbar slot order) and both
 * id and hotkey must be unique — a duplicate of either is a programming
 * error, not a runtime condition to recover from, so it throws at register
 * time rather than silently shadowing.
 */
export class ToolRegistry {
	private readonly order: Tool[] = [];
	private readonly byId = new Map<string, Tool>();
	private readonly byHotkey = new Map<string, Tool>();

	register(tool: Tool): void {
		if (this.byId.has(tool.id)) {
			throw new Error(`tool id "${tool.id}" already registered`);
		}
		if (this.byHotkey.has(tool.hotkey)) {
			throw new Error(`tool hotkey "${tool.hotkey}" already registered`);
		}
		this.order.push(tool);
		this.byId.set(tool.id, tool);
		this.byHotkey.set(tool.hotkey, tool);
	}

	get(id: string): Tool | undefined {
		return this.byId.get(id);
	}

	getByHotkey(hotkey: string): Tool | undefined {
		return this.byHotkey.get(hotkey);
	}

	list(): readonly Tool[] {
		return this.order;
	}

	/** Returns whether a tool with this id was found and dispatched. */
	dispatch(id: string, ctx: ToolContext): boolean {
		const tool = this.byId.get(id);
		if (!tool) return false;
		tool.onUse(ctx);
		return true;
	}

	/** Same as dispatch, keyed by hotkey instead of id. */
	dispatchHotkey(hotkey: string, ctx: ToolContext): boolean {
		const tool = this.byHotkey.get(hotkey);
		if (!tool) return false;
		tool.onUse(ctx);
		return true;
	}
}

// Icon paths point at the sprite pipeline's soft-rendered originals (see
// assets/generated/originals) copied verbatim into every host app's
// public/assets/ (apps/demo/scripts/build-world.mjs). orb and bag have no
// dedicated art yet (crystal orb, bag) — placeholders noted below borrow the
// closest existing icon rather than drawing a new one.
const ICON_BASE = "/assets/originals";

export function createDefaultTools(): Tool[] {
	return [
		{
			id: "opener",
			name: "Opener",
			icon: `${ICON_BASE}/key_256.webp`,
			hotkey: "E",
			// WorldScene polls its own E key directly for frame-accurate movement
			// feel and subscribes to this event too, so a hotbar click behaves
			// identically to pressing E without duplicating the enter-portal logic.
			onUse: (ctx) => ctx.bus.emit("tool:opener-use", {}),
		},
		{
			id: "spyglass",
			name: "Spyglass",
			icon: `${ICON_BASE}/letter_opener_256.webp`,
			hotkey: "L",
			onUse: (ctx) => ctx.store.getState().setSpyglassOpen(true),
		},
		{
			id: "orb",
			name: "Crystal orb",
			icon: "/assets/placeholders/portal_arch_soft.png",
			// Registry hotkey is the display/lookup key; the hotbar's own keydown
			// handler additionally intercepts Cmd/Ctrl+F (browser find) as a second
			// way in — that interception is UI wiring, not registry mechanics.
			hotkey: "F",
			onUse: (ctx) => ctx.store.getState().setSearchOpen(true),
		},
		{
			id: "bag",
			name: "Bag",
			icon: `${ICON_BASE}/file_256.webp`,
			hotkey: "B",
			onUse: (ctx) => ctx.bus.emit("tool:bag-use", {}),
		},
	];
}

export function createDefaultToolRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	for (const tool of createDefaultTools()) registry.register(tool);
	return registry;
}
