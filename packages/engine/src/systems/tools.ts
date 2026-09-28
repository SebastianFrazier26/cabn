import type { StoreApi } from "zustand/vanilla";
import { uiIconPath } from "../assetPaths.js";
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

// M10a: spyglass/orb/bag/quill/wand now have real hand-drawn icons (the
// approved UI mockup, assets/generated/ui/) instead of borrowed placeholders
// — see assetPaths.ts's uiIconPath. Opener keeps the original key icon; it
// was never a placeholder (a literal key reads correctly as "open").
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
			icon: uiIconPath("spyglass"),
			hotkey: "L",
			onUse: (ctx) => ctx.store.getState().setSpyglassOpen(true),
		},
		{
			id: "orb",
			name: "Crystal orb",
			icon: uiIconPath("orb"),
			// Registry hotkey is the display/lookup key; the hotbar's own keydown
			// handler additionally intercepts Cmd/Ctrl+F (browser find) as a second
			// way in — that interception is UI wiring, not registry mechanics.
			hotkey: "F",
			onUse: (ctx) => ctx.store.getState().setSearchOpen(true),
		},
		{
			id: "bag",
			name: "Bag",
			icon: uiIconPath("bag"),
			hotkey: "B",
			onUse: (ctx) => ctx.bus.emit("tool:bag-use", {}),
		},
		{
			id: "quill",
			name: "Quill",
			icon: uiIconPath("quill"),
			hotkey: "Q",
			// Same shape as bag: FileScene owns the actual open-the-overlay logic
			// (it needs the player's current line for the caret), this just signals
			// intent.
			onUse: (ctx) => ctx.bus.emit("tool:quill-use", {}),
		},
		{
			id: "wand",
			name: "Wand",
			icon: uiIconPath("wand"),
			hotkey: "R",
			// FileScene owns the run: it needs the file's current lines/language to
			// build a trace script, same shape as bag/quill above.
			onUse: (ctx) => ctx.bus.emit("tool:wand-use", {}),
		},
	];
}

export function createDefaultToolRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	for (const tool of createDefaultTools()) registry.register(tool);
	return registry;
}
