import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

export interface LayerSaveNoticeProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * A layer file's save that didn't land where the layer keeps it. The edit
 * stays in the buffer (still unsaved); a conflict — the file changed there
 * since it was opened — offers to reload it as it is now.
 */
export function LayerSaveNotice({
	store,
	bus,
}: LayerSaveNoticeProps): React.ReactElement | null {
	const issue = useCabnStore(store, (s) => s.layerSaveIssue);
	if (!issue) return null;
	const dismiss = () => store.getState().setLayerSaveIssue(null);
	return (
		<div
			className="cabn-panel"
			role="alert"
			data-testid="layer-save-issue"
			style={{
				position: "absolute",
				top: 16,
				left: "50%",
				transform: "translateX(-50%)",
				maxWidth: 520,
				zIndex: 16,
				pointerEvents: "auto",
				fontSize: 13,
			}}
		>
			<div style={{ marginBottom: 10 }}>{issue.message}</div>
			<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
				{issue.conflict && (
					<button
						type="button"
						className="cabn-btn confirm"
						data-testid="layer-save-reload"
						onClick={() => {
							bus.emit("layer:reload-file", { portalId: issue.portalId });
							dismiss();
						}}
					>
						Reload from disk
					</button>
				)}
				<button type="button" className="cabn-btn cancel" onClick={dismiss}>
					Keep editing
				</button>
			</div>
		</div>
	);
}
