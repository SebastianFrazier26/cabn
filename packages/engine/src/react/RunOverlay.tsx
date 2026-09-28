import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import type { RunSpeed } from "../systems/runPlayback.js";
import { useCabnStore } from "./useCabnStore.js";

export interface RunOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

function speedButton(
	speed: RunSpeed,
	current: RunSpeed,
	onClick: () => void,
): React.ReactElement {
	const active = speed === current;
	return (
		<button
			type="button"
			onClick={onClick}
			className={`cabn-speed-btn${active ? " active" : ""}`}
		>
			{speed}x
		</button>
	);
}

/**
 * A "spell circle" (three rune rings + four rune dots, replacing the old
 * scroll-roller gradients entirely per IMPLEMENTATION-PLAN.md commit 8 — no
 * roller art either old or new) around the run panel; `@keyframes
 * cabn-unfurl` (pixelTheme.tsx) scales it in from a flat strip on mount —
 * React remounting this element each time `mode` becomes "run" (rather than
 * toggling visibility on a persistent node) is what re-triggers the
 * animation every run. FileScene owns the actual runPlayback state machine;
 * this only reads the republished snapshot (`store.run`) and dispatches
 * control intents onto the bus, same "React never mutates game state
 * directly" shape as every other overlay.
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
			className="cabn-panel cabn-rune-scroll"
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
				transformOrigin: "bottom center",
				animation: "cabn-unfurl 320ms ease-out",
				pointerEvents: "auto",
			}}
		>
			<style>{`
				@keyframes cabn-unfurl {
					from { transform: scaleY(0.05); opacity: 0.4; }
					to { transform: scaleY(1); opacity: 1; }
				}
			`}</style>
			<div className="cabn-rune-ring three" />
			<div className="cabn-rune-ring" />
			<div className="cabn-rune-ring two" />
			<div className="cabn-rune-dot" style={{ top: "6%", left: "50%" }} />
			<div className="cabn-rune-dot" style={{ top: "50%", left: "94%" }} />
			<div className="cabn-rune-dot" style={{ top: "94%", left: "50%" }} />
			<div className="cabn-rune-dot" style={{ top: "50%", left: "6%" }} />
			<div
				style={{
					position: "relative",
					zIndex: 1,
					display: "flex",
					flexDirection: "column",
					gap: 8,
					height: "100%",
					overflow: "hidden",
				}}
			>
				<div style={{ fontWeight: "bold", fontSize: 13 }}>
					Line {run.currentLine}
					{run.approximateLines ? " (approximate)" : ""} — step {run.index + 1}{" "}
					/ {run.totalSteps}
				</div>
				<div className="cabn-run-line-current">{sourceLine || " "}</div>
				{run.status === "blocked" && run.blockedMessage && (
					<div
						style={{ color: "var(--cabn-accent-orange)", fontWeight: "bold" }}
					>
						{run.blockedMessage}
					</div>
				)}
				<div className="cabn-run-log" style={{ flex: 1, overflowY: "auto" }}>
					{run.log.map((entry, i) => (
						// The log is append-only for the lifetime of one run — index is a
						// stable enough key here, there's no reordering/removal to trip on.
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only log
						<div key={i}>{entry}</div>
					))}
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<button
						type="button"
						className="cabn-btn neutral"
						onClick={() =>
							bus.emit(run.status === "playing" ? "run:pause" : "run:play", {})
						}
						style={{ padding: "6px 10px" }}
					>
						{run.status === "playing" ? "Pause" : "Play"}
					</button>
					<button
						type="button"
						className="cabn-speed-btn"
						onClick={() => bus.emit("run:step", {})}
					>
						Step
					</button>
					{speedButton(1, run.speed, () =>
						bus.emit("run:set-speed", { speed: 1 }),
					)}
					{speedButton(2, run.speed, () =>
						bus.emit("run:set-speed", { speed: 2 }),
					)}
					{speedButton(4, run.speed, () =>
						bus.emit("run:set-speed", { speed: 4 }),
					)}
					<button
						type="button"
						className="cabn-speed-btn"
						onClick={() => bus.emit("run:stop", {})}
						style={{ marginLeft: "auto" }}
					>
						Stop (Esc)
					</button>
				</div>
			</div>
		</div>
	);
}
