import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

export interface FileOverlayProps {
	store: StoreApi<CabnStore>;
}

// M4: FileScene (a real walkable scroll world, see scenes/FileScene.ts) is
// now the file viewer for anything with text content. This overlay's job
// shrinks to what it can't do: a binary/sealed file (activePortalContent ===
// null) has nothing for FileScene to render, so WorldScene never launches
// it and mode just flips to "file" with no content — this is that fallback.
export function FileOverlay({
	store,
}: FileOverlayProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const portalId = useCabnStore(store, (s) => s.activePortalId);
	const content = useCabnStore(store, (s) => s.activePortalContent);
	const isBinaryFallback = mode === "file" && content === null;

	useEffect(() => {
		if (!isBinaryFallback) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") store.getState().exitPortal();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isBinaryFallback, store]);

	if (!isBinaryFallback) return null;

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				background: "rgba(50, 34, 20, 0.85)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				zIndex: 10,
			}}
		>
			<div
				className="cabn-panel"
				style={{
					width: "min(720px, 90vw)",
					maxHeight: "80vh",
					display: "flex",
					flexDirection: "column",
					padding: 0,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "10px 16px",
						borderBottom: "3px solid var(--cabn-border-outer)",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<strong>{portalId ?? "(unknown file)"}</strong>
					<span style={{ opacity: 0.7 }}>Esc to leave</span>
				</div>
				<pre
					style={{
						margin: 0,
						padding: 16,
						overflow: "auto",
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						fontFamily: "var(--cabn-font-mono)",
					}}
				>
					(binary or unreadable file — no preview available)
				</pre>
			</div>
		</div>
	);
}
