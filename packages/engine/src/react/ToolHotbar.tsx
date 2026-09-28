import { useEffect, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import {
	createDefaultToolRegistry,
	type Tool,
	type ToolRegistry,
} from "../systems/tools.js";
import { useCabnStore } from "./useCabnStore.js";

export interface ToolHotbarProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

// Which tool's slot gets the mockup's gold-ring "selected" treatment — most
// tools are momentary actions with no persistent "equipped" state, so this
// only covers spyglass/orb (a real open/closed panel to reflect). quill/wand
// have their own open states too (mode === "editor"/"run"), but the whole
// hotbar is hidden in both of those modes (see the early return below), so
// there's no slot left to ring; opener/bag have no open state at all.
function isToolSelected(
	toolId: string,
	state: { spyglassOpen: boolean; searchOpen: boolean },
): boolean {
	if (toolId === "spyglass") return state.spyglassOpen;
	if (toolId === "orb") return state.searchOpen;
	return false;
}

function isTypingTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(target.tagName === "INPUT" || target.tagName === "TEXTAREA")
	);
}

/**
 * Bottom hotbar rendering the tool registry's slots. Owns the one global
 * keydown listener for the React-side tools (L/F, Cmd/Ctrl+F) — E stays
 * Phaser-only (WorldScene polls it directly for frame-accurate movement
 * feel; see systems/tools.ts's opener comment) so it isn't bound here.
 */
export function ToolHotbar({
	store,
	bus,
}: ToolHotbarProps): React.ReactElement | null {
	const [registry] = useState<ToolRegistry>(() => createDefaultToolRegistry());
	const bagCount = useCabnStore(store, (s) => s.bagSlots.length);
	const mode = useCabnStore(store, (s) => s.mode);
	const spyglassOpen = useCabnStore(store, (s) => s.spyglassOpen);
	const searchOpen = useCabnStore(store, (s) => s.searchOpen);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// The editor traps its own keys (including single letters that would
			// otherwise dispatch a tool, e.g. typing "b" in code) — CodeMirror's
			// content div isn't an <input>/<textarea> so isTypingTarget alone
			// wouldn't catch it, hence the explicit mode check. A run in progress
			// has its own keys (Space/N/1-2-4/Esc, see RunOverlay) that would
			// otherwise collide with nothing here today but are excluded on the
			// same principle — this hotbar's keys are for "not currently inside
			// another modal thing".
			const currentMode = store.getState().mode;
			if (currentMode === "editor" || currentMode === "run") return;

			const key = event.key.toLowerCase();

			// Cmd/Ctrl+F always intercepts, even while the orb's own search input
			// is focused — the whole point is stopping the browser's native find
			// from popping up over the game.
			if (key === "f" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				registry.dispatch("orb", { store, bus });
				return;
			}
			if (isTypingTarget(event.target)) return;

			if (key === "f") registry.dispatch("orb", { store, bus });
			else if (key === "l") registry.dispatch("spyglass", { store, bus });
			else if (key === "b") registry.dispatch("bag", { store, bus });
			else if (key === "q") registry.dispatch("quill", { store, bus });
			else if (key === "r") registry.dispatch("wand", { store, bus });
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [registry, store, bus]);

	// Hidden rather than just non-interactive while the editor is open — its
	// tools (opener/spyglass/orb/bag-as-selection) all read as "world/file
	// navigation", none of which apply mid-edit, and the space is better left
	// to the editor panel. Same reasoning for a run in progress: RunOverlay
	// owns the screen instead.
	if (mode === "editor" || mode === "run") return null;

	return (
		<div
			style={{
				position: "absolute",
				bottom: 12,
				left: 0,
				right: 0,
				display: "flex",
				justifyContent: "center",
				gap: 10,
				zIndex: 5,
				pointerEvents: "none",
			}}
		>
			{registry.list().map((tool) => (
				<HotbarSlot
					key={tool.id}
					tool={tool}
					badge={tool.id === "bag" && bagCount > 0 ? bagCount : null}
					selected={isToolSelected(tool.id, { spyglassOpen, searchOpen })}
					onUse={() => registry.dispatch(tool.id, { store, bus })}
				/>
			))}
		</div>
	);
}

function HotbarSlot({
	tool,
	badge,
	selected,
	onUse,
}: {
	tool: Tool;
	badge: number | null;
	selected: boolean;
	onUse: () => void;
}): React.ReactElement {
	return (
		<button
			type="button"
			onClick={onUse}
			title={`${tool.name} (${tool.hotkey})`}
			className={`cabn-hotbar-slot${selected ? " selected" : ""}`}
			style={{ pointerEvents: "auto" }}
		>
			<img src={tool.icon} alt={tool.name} />
			<span className="cabn-key">{tool.hotkey}</span>
			{badge !== null && <span className="cabn-badge">{badge}</span>}
		</button>
	);
}
