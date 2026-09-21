import { useMemo } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { useCabnStore } from "./useCabnStore.js";

export interface SpyglassPanelProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	return `${(bytes / 1024).toFixed(1)}KB`;
}

/** "ls" for the cluster you're standing in — click a row to auto-walk there. */
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

	if (!open) return null;

	return (
		<div
			style={{
				position: "absolute",
				top: 16,
				right: 16,
				width: 260,
				maxHeight: "60vh",
				overflow: "auto",
				background: toCssColor(PALETTE.parchment),
				color: toCssColor(PALETTE.ink),
				border: `2px solid ${toCssColor(PALETTE.ink)}`,
				borderRadius: 6,
				fontFamily: '"Courier New", monospace',
				fontSize: 12,
				zIndex: 6,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					padding: "6px 10px",
					borderBottom: `2px solid ${toCssColor(PALETTE.ink)}`,
					fontWeight: "bold",
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
					}}
				>
					x
				</button>
			</div>
			{rows.length === 0 ? (
				<div style={{ padding: 10, opacity: 0.7 }}>no portals nearby</div>
			) : (
				<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
					{rows.map((portal) => (
						<li key={portal.id}>
							<button
								type="button"
								onClick={() => {
									bus.emit("tool:walk-to-portal", { portalId: portal.id });
									store.getState().setSpyglassOpen(false);
								}}
								style={{
									width: "100%",
									textAlign: "left",
									background: "none",
									border: "none",
									borderBottom: `1px solid ${toCssColor(PALETTE.trail)}`,
									padding: "6px 10px",
									cursor: "pointer",
									color: "inherit",
									display: "flex",
									justifyContent: "space-between",
									gap: 8,
								}}
							>
								<span>{portal.name}</span>
								<span style={{ opacity: 0.7 }}>
									{portal.kind} · {formatBytes(portal.bytes)}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
