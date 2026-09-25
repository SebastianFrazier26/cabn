import { useEffect, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
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
}: ToolHotbarProps): React.ReactElement {
	const [registry] = useState<ToolRegistry>(() => createDefaultToolRegistry());
	const bagCount = useCabnStore(store, (s) => s.bagSlots.length);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
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
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [registry, store, bus]);

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
					onUse={() => registry.dispatch(tool.id, { store, bus })}
				/>
			))}
		</div>
	);
}

function HotbarSlot({
	tool,
	badge,
	onUse,
}: {
	tool: Tool;
	badge: number | null;
	onUse: () => void;
}): React.ReactElement {
	return (
		<button
			type="button"
			onClick={onUse}
			title={`${tool.name} (${tool.hotkey})`}
			style={{
				position: "relative",
				pointerEvents: "auto",
				width: 48,
				height: 48,
				background: toCssColor(PALETTE.parchment),
				border: `2px solid ${toCssColor(PALETTE.ink)}`,
				borderRadius: 6,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
				padding: 2,
			}}
		>
			<img
				src={tool.icon}
				alt={tool.name}
				style={{
					width: 26,
					height: 26,
					objectFit: "contain",
					imageRendering: "pixelated",
				}}
			/>
			<span
				style={{
					fontSize: 9,
					lineHeight: 1,
					color: toCssColor(PALETTE.ink),
					fontFamily: '"Courier New", monospace',
				}}
			>
				{tool.hotkey}
			</span>
			{badge !== null && (
				<span
					style={{
						position: "absolute",
						top: -6,
						right: -6,
						background: toCssColor(PALETTE.trail),
						color: toCssColor(PALETTE.cream),
						borderRadius: "50%",
						width: 16,
						height: 16,
						fontSize: 10,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{badge}
				</span>
			)}
		</button>
	);
}
