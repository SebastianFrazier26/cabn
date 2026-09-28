import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { PortalEmbed } from "./PortalEmbed.js";
import { PortalPreview } from "./PortalPreview.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PortalPreviewDockProps {
	store: StoreApi<CabnStore>;
}

/**
 * The expanded preview for whichever world portal the player is standing at
 * (WorldScene sets `focusedPortalPreview` inside PORTAL_FOCUS_RADIUS and
 * clears it on leaving). The in-arch preview is a static canvas snapshot
 * (render/archPreviews.ts); this is the full, scrollable view — CodeMirror
 * for code, rendered markdown, the full image — and, for a url preview, the
 * live PortalEmbed iframe.
 *
 * The embed exists only while this portal is focused: leaving it nulls the
 * store field, this component returns null, and React unmounts the iframe
 * (it's never merely hidden). Keyed by portal id so walking straight from one
 * url portal to another tears the first frame down before mounting the next.
 */
export function PortalPreviewDock({
	store,
}: PortalPreviewDockProps): React.ReactElement | null {
	const focused = useCabnStore(store, (s) => s.focusedPortalPreview);
	const mode = useCabnStore(store, (s) => s.mode);
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const spyglassOpen = useCabnStore(store, (s) => s.spyglassOpen);

	if (!focused || mode !== "world" || spyglassOpen || worldBase === null)
		return null;

	const { preview } = focused;

	return (
		<div
			key={focused.portalId}
			data-testid="portal-preview-dock"
			className="cabn-preview-dock"
			style={{
				position: "absolute",
				right: 16,
				top: "50%",
				transform: "translateY(-50%)",
				width: "min(440px, 42vw)",
				height: "min(380px, 58vh)",
				display: "flex",
				flexDirection: "column",
			}}
		>
			{preview.kind === "url" ? (
				<div
					className="cabn-panel"
					style={{
						height: "100%",
						display: "flex",
						flexDirection: "column",
					}}
				>
					<div className="cabn-panel-title" style={{ marginBottom: 6 }}>
						{focused.fileName}
					</div>
					<div style={{ flex: 1, minHeight: 0 }}>
						<PortalEmbed
							url={preview.url}
							{...(preview.title !== undefined ? { title: preview.title } : {})}
							{...(preview.fallbackImage !== undefined
								? { fallbackImage: preview.fallbackImage }
								: {})}
							allowedEmbedOrigins={focused.allowedEmbedOrigins}
							worldBaseUrl={worldBase}
							active
						/>
					</div>
				</div>
			) : (
				<PortalPreview
					preview={preview}
					fileName={focused.fileName}
					worldBaseUrl={worldBase}
					variant="expanded"
				/>
			)}
		</div>
	);
}
