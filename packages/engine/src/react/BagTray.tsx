import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import { useCabnStore } from "./useCabnStore.js";

export interface BagTrayProps {
	store: StoreApi<CabnStore>;
}

/**
 * Grabbed line ranges, shown as a small tray once there's anything in it —
 * no open/close toggle, since the bag itself has nothing to configure yet.
 * Paste is M5 (needs the editor); the tooltip says so rather than pretending
 * the slots do something they don't yet.
 */
export function BagTray({ store }: BagTrayProps): React.ReactElement | null {
	const slots = useCabnStore(store, (s) => s.bagSlots);
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
				zIndex: 5,
			}}
			title="paste arrives with the quill"
		>
			{slots.map((slot) => (
				<div
					key={slot.id}
					style={{
						background: toCssColor(PALETTE.parchment),
						color: toCssColor(PALETTE.ink),
						border: `1px solid ${toCssColor(PALETTE.ink)}`,
						borderRadius: 4,
						padding: "3px 8px",
						fontFamily: '"Courier New", monospace',
						fontSize: 11,
						maxWidth: 220,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{slot.sourcePortalId}:{slot.startLine + 1}
					{slot.endLine !== slot.startLine ? `-${slot.endLine + 1}` : ""}
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
			))}
		</div>
	);
}
