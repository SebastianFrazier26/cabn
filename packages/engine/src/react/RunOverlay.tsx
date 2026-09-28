import type { StoreApi } from "zustand/vanilla";
import { uiIconPath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { RunConsole } from "./RunConsole.js";
import { useCabnStore } from "./useCabnStore.js";

export interface RunOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * The wand's literal cast: a rune circle (three rings + four dots, unchanged
 * from the M10a mockup) snaps in fast — `@keyframes cabn-wand-cast`
 * (pixelTheme.tsx) scales/rotates it in from nothing in under 500ms, a "cast"
 * pop rather than the old scroll-styled `cabn-unfurl` (a scaleY-only
 * unrolling motion that read as parchment, which the approved design
 * explicitly rejects — see M10 plan's "no wood or parchment textures").
 * `prefers-reduced-motion: reduce` falls back to a plain fade (pixelTheme.tsx
 * gates the animation, not this component). React remounting this element
 * each time `mode` becomes "run" (rather than toggling visibility on a
 * persistent node) is what re-triggers it every run. FileScene owns the
 * actual runPlayback state machine; this only reads the republished snapshot
 * (`store.run`) and dispatches control intents onto the bus, same "React
 * never mutates game state directly" shape as every other overlay.
 *
 * This is the "run from the world" flow only — running from inside the
 * spellbook (Ctrl/Cmd+Enter or its own Run button) uses a separate, book-local
 * run console instead of this one; see EditorOverlay.tsx's doc comment for
 * why the two don't share a state machine.
 */
export function RunOverlay({
	store,
	bus,
}: RunOverlayProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const run = useCabnStore(store, (s) => s.run);
	const content = useCabnStore(store, (s) => s.activePortalContent);

	if (mode !== "run" || !run) return null;

	const lines = content?.split("\n") ?? [];
	const sourceLine = lines[run.currentLine - 1] ?? "";

	return (
		<div
			className="cabn-panel cabn-wand-cast"
			style={{
				position: "absolute",
				right: 16,
				bottom: 16,
				width: "38%",
				minWidth: 320,
				height: "34%",
				minHeight: 220,
				zIndex: 8,
				overflow: "hidden",
				pointerEvents: "auto",
			}}
		>
			<div className="cabn-rune-ring three" />
			<div className="cabn-rune-ring" />
			<div className="cabn-rune-ring two" />
			<div className="cabn-rune-dot" style={{ top: "6%", left: "50%" }} />
			<div className="cabn-rune-dot" style={{ top: "50%", left: "94%" }} />
			<div className="cabn-rune-dot" style={{ top: "94%", left: "50%" }} />
			<div className="cabn-rune-dot" style={{ top: "50%", left: "6%" }} />
			<img
				src={uiIconPath("wand")}
				alt=""
				className="cabn-wand-cast-icon"
				aria-hidden="true"
			/>
			<div style={{ position: "relative", zIndex: 1, height: "100%" }}>
				<RunConsole
					run={run}
					sourceLine={sourceLine}
					onPlayPause={() =>
						bus.emit(run.status === "playing" ? "run:pause" : "run:play", {})
					}
					onStep={() => bus.emit("run:step", {})}
					onSetSpeed={(speed) => bus.emit("run:set-speed", { speed })}
					onStop={() => bus.emit("run:stop", {})}
					stopLabel="Stop (Esc)"
				/>
			</div>
		</div>
	);
}
