import {
	currentStep,
	type RunPlaybackState,
	type RunSpeed,
	type RunStatus,
} from "../systems/runPlayback.js";

export interface RunConsoleSnapshot {
	totalSteps: number;
	index: number;
	currentLine: number;
	status: RunStatus;
	speed: RunSpeed;
	log: string[];
	blockedMessage?: string;
	approximateLines: boolean;
}

export interface RunConsoleProps {
	run: RunConsoleSnapshot;
	sourceLine: string;
	onPlayPause: () => void;
	onStep: () => void;
	onSetSpeed: (speed: RunSpeed) => void;
	onStop: () => void;
	/** RunOverlay (the world run, Esc-able) vs. the spellbook's inline quick-run (no Esc binding of its own — Esc already closes the book). */
	stopLabel: string;
}

/**
 * SpellbookOverlay's own book-local `RunPlaybackState` (driven independently
 * in React, see that file's doc comment) into the same snapshot shape
 * RunOverlayState already gives RunOverlay — `approximateLines: false`
 * unconditionally, same simplification FileScene's own buildRunSnapshot()
 * makes for every provider today.
 */
export function toRunConsoleSnapshot(
	state: RunPlaybackState,
): RunConsoleSnapshot {
	return {
		totalSteps: state.steps.length,
		index: state.index,
		currentLine: currentStep(state)?.line ?? 0,
		status: state.status,
		speed: state.speed,
		log: state.log,
		blockedMessage: state.blockedMessage,
		approximateLines: false,
	};
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
 * The play/pause/step/speed/stop console + line readout + log, shared between
 * RunOverlay (the wand's full-screen world run, driven by FileScene's
 * runPlayback state machine over the bus) and SpellbookOverlay's inline
 * quick-run (driven independently in React — see SpellbookOverlay's own doc
 * comment on why the two runs don't share one state machine). Pure
 * presentation only: every control is a callback prop, so this component
 * never knows which of the two run flows it's rendering for.
 */
export function RunConsole({
	run,
	sourceLine,
	onPlayPause,
	onStep,
	onSetSpeed,
	onStop,
	stopLabel,
}: RunConsoleProps): React.ReactElement {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 8,
				height: "100%",
				overflow: "hidden",
			}}
		>
			<div style={{ fontWeight: "bold", fontSize: 13 }}>
				Line {run.currentLine}
				{run.approximateLines ? " (approximate)" : ""} — step {run.index + 1} /{" "}
				{run.totalSteps}
			</div>
			<div className="cabn-run-line-current">{sourceLine || " "}</div>
			{run.status === "blocked" && run.blockedMessage && (
				<div style={{ color: "var(--cabn-accent-orange)", fontWeight: "bold" }}>
					{run.blockedMessage}
				</div>
			)}
			{/* tabIndex/role/aria-label: a scrollable region with no focusable
			    content of its own needs its own tab stop (axe:
			    scrollable-region-focusable), same reasoning as DiffView's. */}
			<div
				className="cabn-run-log"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: see comment above.
				tabIndex={0}
				role="log"
				aria-label="Run log"
				style={{ flex: 1, overflowY: "auto" }}
			>
				{run.log.map((entry, i) => (
					// Append-only log for the lifetime of one run — index is a stable
					// enough key, no reordering/removal to trip on.
					// biome-ignore lint/suspicious/noArrayIndexKey: append-only log
					<div key={i}>{entry}</div>
				))}
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<button
					type="button"
					className="cabn-btn neutral"
					onClick={onPlayPause}
					style={{ padding: "6px 10px" }}
				>
					{run.status === "playing" ? "Pause" : "Play"}
				</button>
				<button type="button" className="cabn-speed-btn" onClick={onStep}>
					Step
				</button>
				{speedButton(1, run.speed, () => onSetSpeed(1))}
				{speedButton(2, run.speed, () => onSetSpeed(2))}
				{speedButton(4, run.speed, () => onSetSpeed(4))}
				<button
					type="button"
					className="cabn-speed-btn"
					onClick={onStop}
					style={{ marginLeft: "auto" }}
				>
					{stopLabel}
				</button>
			</div>
		</div>
	);
}
