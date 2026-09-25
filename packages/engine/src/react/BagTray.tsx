import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { useCabnStore } from "./useCabnStore.js";

export interface BagTrayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * Grabbed line ranges, shown as a small tray once there's anything in it —
 * no open/close toggle, since the bag itself has nothing to configure yet.
 * While the quill editor is open each slot's label is also a paste button
 * (emits `editor:paste-slot`, EditorOverlay does the actual insertion);
 * otherwise it's inert but the tooltip still explains why.
 */
export function BagTray({
	store,
	bus,
}: BagTrayProps): React.ReactElement | null {
	const slots = useCabnStore(store, (s) => s.bagSlots);
	const mode = useCabnStore(store, (s) => s.mode);
	const pasteEnabled = mode === "editor";
	if (slots.length === 0) return null;

	return (
		<div
			style={{
				position: "absolute",
				bottom: 72,
				left: 16,
				display: "flex",
				flexDirection: "column",
				gap: 4,
				// Above the editor's own panel (zIndex 8) so the tray stays usable
				// as a paste source while the editor covers the rest of the screen.
				zIndex: 9,
			}}
			title={
				pasteEnabled
					? "click a slot to paste it at the cursor"
					: "paste arrives with the quill"
			}
		>
			{slots.map((slot) => {
				const label = (
					<>
						{slot.sourcePortalId}:{slot.startLine + 1}
						{slot.endLine !== slot.startLine ? `-${slot.endLine + 1}` : ""}
					</>
				);
				const labelStyle: React.CSSProperties = {
					flex: 1,
					textAlign: "left",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				};
				return (
					<div
						key={slot.id}
						style={{
							display: "flex",
							alignItems: "center",
							background: toCssColor(PALETTE.parchment),
							color: toCssColor(PALETTE.ink),
							border: `1px solid ${toCssColor(PALETTE.ink)}`,
							borderRadius: 4,
							padding: "3px 8px",
							fontFamily: '"Courier New", monospace',
							fontSize: 11,
							maxWidth: 220,
						}}
					>
						{pasteEnabled ? (
							<button
								type="button"
								onClick={() =>
									bus.emit("editor:paste-slot", { slotId: slot.id })
								}
								style={{
									...labelStyle,
									background: "none",
									border: "none",
									color: "inherit",
									font: "inherit",
									cursor: "pointer",
								}}
							>
								{label}
							</button>
						) : (
							<span style={labelStyle}>{label}</span>
						)}
						<button
							type="button"
							onClick={() => store.getState().removeBagSlot(slot.id)}
							style={{
								marginLeft: 6,
								background: "none",
								border: "none",
								cursor: "pointer",
								color: "inherit",
								opacity: 0.6,
							}}
						>
							x
						</button>
					</div>
				);
			})}
		</div>
	);
}
