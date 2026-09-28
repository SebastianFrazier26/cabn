import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import { uiIconPath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

export interface BagTrayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * Grabbed line ranges, shown as a literal satchel once there's anything in
 * it. Closed by default (a small badge, bottom-left) — clicking it opens the
 * satchel flap to show every slot as a physical pouch inside; clicking again
 * (or Esc) closes it. While the quill editor is open each pouch is also a
 * paste button (emits `editor:paste-slot`, EditorOverlay does the actual
 * insertion); otherwise it's inert but the tooltip still explains why. The
 * grab-a-new-slot mechanic itself (hotkey B / `tool:bag-use`) is unrelated to
 * this open/close state — see bridge/store.ts's `bagOpen` doc comment.
 */
export function BagTray({
	store,
	bus,
}: BagTrayProps): React.ReactElement | null {
	const slots = useCabnStore(store, (s) => s.bagSlots);
	const mode = useCabnStore(store, (s) => s.mode);
	const bagOpen = useCabnStore(store, (s) => s.bagOpen);
	const pasteEnabled = mode === "editor";

	useEffect(() => {
		if (!bagOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Same capture + preventDefault as SpyglassPanel's Esc.
			event.preventDefault();
			store.getState().setBagOpen(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [bagOpen, store]);

	if (slots.length === 0) return null;

	return (
		<div
			style={{
				position: "absolute",
				// bottom: 72, not 16 — MonsterCounter's own HUD pill already sits at
				// bottom:16/left:16 (same corner); this stacks the satchel above it
				// rather than covering it, same offset the original BagTray used.
				bottom: 72,
				left: 16,
				// Above the editor's own panel (zIndex 8) so the satchel stays usable
				// as a paste source while the spellbook covers the rest of the screen.
				zIndex: 9,
				// PixelTheme's wrapper is pointerEvents: "none" so it never blocks the
				// canvas underneath — this tray has real click targets, so it opts
				// back in explicitly.
				pointerEvents: "auto",
			}}
		>
			{bagOpen ? (
				<div key="open" className="cabn-satchel-open">
					<div className="cabn-satchel-flap" />
					<div className="cabn-panel-title" style={{ margin: "0 0 6px" }}>
						<span>Bag</span>
					</div>
					<div
						style={{
							display: "flex",
							flexWrap: "wrap",
							gap: 8,
							maxWidth: 320,
						}}
						title={
							pasteEnabled
								? "click a pouch to paste it at the cursor"
								: "paste arrives with the quill"
						}
					>
						{slots.map((slot) => {
							const label = (
								<>
									{slot.sourcePortalId}:{slot.startLine + 1}
									{slot.endLine !== slot.startLine
										? `-${slot.endLine + 1}`
										: ""}
								</>
							);
							return (
								<div key={slot.id} className="cabn-bag-pouch">
									{pasteEnabled ? (
										<button
											type="button"
											onClick={() =>
												bus.emit("editor:paste-slot", { slotId: slot.id })
											}
											className="cabn-bag-pouch-label"
										>
											{label}
										</button>
									) : (
										<span className="cabn-bag-pouch-label">{label}</span>
									)}
									<button
										type="button"
										className="cabn-x"
										title="drop this slot"
										onClick={() => store.getState().removeBagSlot(slot.id)}
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
							);
						})}
					</div>
					<button
						type="button"
						className="cabn-btn neutral"
						onClick={() => store.getState().setBagOpen(false)}
						style={{ marginTop: 10, padding: "5px 14px", fontSize: 11 }}
					>
						Close
					</button>
				</div>
			) : (
				<button
					type="button"
					className="cabn-satchel-closed"
					title="open the bag"
					onClick={() => store.getState().setBagOpen(true)}
				>
					<img src={uiIconPath("bag")} alt="" />
					<span className="cabn-badge">{slots.length}</span>
				</button>
			)}
		</div>
	);
}
