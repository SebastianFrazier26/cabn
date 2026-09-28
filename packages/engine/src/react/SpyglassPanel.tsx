import { useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { uiSparklePath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

// The open-burst sparkle positions/colors for this panel — cyan/gold, per
// STYLE.md's per-tool color pairings.
const OPEN_BURST_SPARKS: ReadonlyArray<{
	color: "cyan" | "gold";
	tx: number;
	ty: number;
	delayMs: number;
}> = [
	{ color: "cyan", tx: -60, ty: -40, delayMs: 0 },
	{ color: "cyan", tx: 60, ty: -30, delayMs: 60 },
	{ color: "gold", tx: 0, ty: -70, delayMs: 120 },
	{ color: "cyan", tx: -70, ty: 30, delayMs: 180 },
];

export interface SpyglassPanelProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	return `${(bytes / 1024).toFixed(1)}KB`;
}

/**
 * "ls" for the cluster you're standing in, viewed through a literal spyglass —
 * a round brass-rimmed lens (`cabn-spyglass-frame`, pixelTheme.tsx) the file
 * list sits inside of, rather than a plain rectangular panel. Opens with an
 * iris-open clip-path animation (`cabn-iris-open`), falling back to a plain
 * fade under reduced motion. Click a row to auto-walk there.
 */
export function SpyglassPanel({
	store,
	bus,
}: SpyglassPanelProps): React.ReactElement | null {
	const open = useCabnStore(store, (s) => s.spyglassOpen);
	const activeClusterId = useCabnStore(store, (s) => s.activeClusterId);
	const portals = useCabnStore(store, (s) => s.portals);

	const rows = useMemo(
		() => portals.filter((p) => p.clusterId === activeClusterId),
		[portals, activeClusterId],
	);

	// Remounting the whole lens (key={playToken}) on every open is what
	// retriggers its CSS animation — the same "remount == retrigger" pattern
	// every other tool screen's open animation relies on.
	const [playToken, setPlayToken] = useState(0);
	useEffect(() => {
		if (open) setPlayToken((token) => token + 1);
	}, [open]);

	// Previously only closable via the "x" button or clicking a row — every
	// other panel already closes on Esc (OrbSearch, EditorOverlay), so this
	// was a real gap, not an intentional difference.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") store.getState().setSpyglassOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, store]);

	if (!open) return null;

	return (
		<div
			key={playToken}
			className="cabn-spyglass-frame"
			style={{
				position: "absolute",
				top: 16,
				right: 16,
				zIndex: 6,
				pointerEvents: "auto",
			}}
		>
			<div className="cabn-panel cabn-spyglass-lens" style={{ fontSize: 12 }}>
				<div
					className="cabn-panel-title"
					style={{
						display: "flex",
						justifyContent: "space-between",
						margin: 0,
					}}
				>
					<span>ls</span>
					<button
						type="button"
						onClick={() => store.getState().setSpyglassOpen(false)}
						style={{
							background: "none",
							border: "none",
							cursor: "pointer",
							color: "inherit",
							font: "inherit",
						}}
					>
						x
					</button>
				</div>
				<div className="cabn-panel-divider" />
				<div style={{ maxHeight: "min(42vh, 220px)", overflow: "auto" }}>
					{rows.length === 0 ? (
						<div style={{ padding: 10, opacity: 0.7 }}>no portals nearby</div>
					) : (
						<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
							{rows.map((portal) => (
								<li
									key={portal.id}
									style={{
										position: "relative",
										zIndex: 1,
										display: "flex",
										alignItems: "center",
										borderBottom: "2px dotted var(--cabn-border-outer)",
									}}
								>
									<button
										type="button"
										onClick={() => {
											bus.emit("tool:walk-to-portal", { portalId: portal.id });
											store.getState().setSpyglassOpen(false);
										}}
										style={{
											flex: 1,
											textAlign: "left",
											background: "none",
											border: "none",
											font: "inherit",
											padding: "6px 4px",
											cursor: "pointer",
											color: "inherit",
											display: "flex",
											justifyContent: "space-between",
											gap: 8,
										}}
									>
										<span>
											{portal.edited && (
												<span
													title="edited"
													style={{
														color: "var(--cabn-accent-yellow)",
														marginRight: 4,
													}}
												>
													✎
												</span>
											)}
											{portal.name}
										</span>
										<span
											style={{
												opacity: 0.7,
												color: "var(--cabn-text-secondary)",
											}}
										>
											{portal.kind} · {formatBytes(portal.bytes)}
										</span>
									</button>
									{portal.edited && (
										<button
											type="button"
											title="discard this file's saved edits"
											onClick={() =>
												bus.emit("tool:reset-file-edits", {
													portalId: portal.id,
												})
											}
											style={{
												background: "none",
												border: "none",
												cursor: "pointer",
												color: "inherit",
												font: "inherit",
												opacity: 0.6,
												padding: "6px 8px",
											}}
										>
											reset
										</button>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="cabn-effect-burst play">
					{OPEN_BURST_SPARKS.map((s, i) => (
						// Fixed, static per-render burst layout, never reordered — index is
						// a stable enough key, same reasoning as RunOverlay's log.
						<img
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed, static list
							key={i}
							className="cabn-spark"
							src={uiSparklePath(s.color)}
							alt=""
							style={
								{
									"--cabn-tx": `${s.tx}px`,
									"--cabn-ty": `${s.ty}px`,
									animationDelay: `${s.delayMs}ms`,
								} as React.CSSProperties
							}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
