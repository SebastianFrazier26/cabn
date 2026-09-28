import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import type { RunSpeed } from "../systems/runPlayback.js";
import { useCabnStore } from "./useCabnStore.js";

export interface RunOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

const ROLLER_HEIGHT = 14;
// A radial-gradient roller reads as a cylinder without an actual sprite —
// same "placeholder-first" approach the rest of this package takes with art
// that doesn't exist yet (see systems/tools.ts's icon comment).
const ROLLER_GRADIENT = `radial-gradient(ellipse at center, ${toCssColor(
	PALETTE.parchmentDark,
)} 0%, ${toCssColor(PALETTE.trail)} 100%)`;

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
			style={{
				cursor: "pointer",
				border: `1px solid ${toCssColor(PALETTE.ink)}`,
				borderRadius: 4,
				background: active ? toCssColor(PALETTE.gold) : "none",
				color: toCssColor(PALETTE.ink),
				padding: "2px 8px",
				fontFamily: '"Courier New", monospace',
				fontSize: 11,
			}}
		>
			{speed}x
		</button>
	);
}

/**
 * A parchment scroll unfurling over the bottom/right third of the screen —
 * `@keyframes cabn-unfurl` (see the injected <style> below) scales it in from
 * a flat strip on mount; React remounting this element each time `mode`
 * becomes "run" (rather than toggling visibility on a persistent node) is
 * what re-triggers the animation every run. FileScene owns the actual
 * runPlayback state machine; this only reads the republished snapshot
 * (`store.run`) and dispatches control intents onto the bus, same "React
 * never mutates game state directly" shape as every other overlay.
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
			style={{
				position: "absolute",
				right: 0,
				bottom: 0,
				width: "38%",
				minWidth: 320,
				height: "34%",
				minHeight: 220,
				zIndex: 8,
				display: "flex",
				flexDirection: "column",
				transformOrigin: "bottom center",
				animation: "cabn-unfurl 320ms ease-out",
			}}
		>
			<style>{`
				@keyframes cabn-unfurl {
					from { transform: scaleY(0.05); opacity: 0.4; }
					to { transform: scaleY(1); opacity: 1; }
				}
			`}</style>
			<div style={{ height: ROLLER_HEIGHT, background: ROLLER_GRADIENT }} />
			<div
				style={{
					flex: 1,
					background: toCssColor(PALETTE.parchment),
					color: toCssColor(PALETTE.ink),
					borderLeft: `2px solid ${toCssColor(PALETTE.ink)}`,
					borderRight: `2px solid ${toCssColor(PALETTE.ink)}`,
					padding: "10px 14px",
					display: "flex",
					flexDirection: "column",
					gap: 8,
					fontFamily: '"Courier New", monospace',
					fontSize: 12,
					overflow: "hidden",
				}}
			>
				<div style={{ fontWeight: "bold" }}>
					Line {run.currentLine}
					{run.approximateLines ? " (approximate)" : ""} — step {run.index + 1}{" "}
					/ {run.totalSteps}
				</div>
				<div
					style={{
						background: toCssColor(PALETTE.parchmentDark),
						borderRadius: 4,
						padding: "4px 8px",
						whiteSpace: "pre",
						overflowX: "auto",
					}}
				>
					{sourceLine || " "}
				</div>
				{run.status === "blocked" && run.blockedMessage && (
					<div style={{ color: toCssColor(PALETTE.gold), fontWeight: "bold" }}>
						{run.blockedMessage}
					</div>
				)}
				<div
					style={{
						flex: 1,
						overflowY: "auto",
						background: "rgba(0,0,0,0.05)",
						borderRadius: 4,
						padding: "4px 8px",
					}}
				>
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
						onClick={() =>
							bus.emit(run.status === "playing" ? "run:pause" : "run:play", {})
						}
						style={{
							cursor: "pointer",
							border: `1px solid ${toCssColor(PALETTE.ink)}`,
							borderRadius: 4,
							background: toCssColor(PALETTE.parchmentDark),
							color: toCssColor(PALETTE.ink),
							padding: "3px 10px",
						}}
					>
						{run.status === "playing" ? "Pause" : "Play"}
					</button>
					<button
						type="button"
						onClick={() => bus.emit("run:step", {})}
						style={{
							cursor: "pointer",
							border: `1px solid ${toCssColor(PALETTE.ink)}`,
							borderRadius: 4,
							background: "none",
							color: toCssColor(PALETTE.ink),
							padding: "3px 10px",
						}}
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
						onClick={() => bus.emit("run:stop", {})}
						style={{
							cursor: "pointer",
							marginLeft: "auto",
							border: `1px solid ${toCssColor(PALETTE.ink)}`,
							borderRadius: 4,
							background: "none",
							color: toCssColor(PALETTE.ink),
							padding: "3px 10px",
						}}
					>
						Stop (Esc)
					</button>
				</div>
			</div>
			<div style={{ height: ROLLER_HEIGHT, background: ROLLER_GRADIENT }} />
		</div>
	);
}
