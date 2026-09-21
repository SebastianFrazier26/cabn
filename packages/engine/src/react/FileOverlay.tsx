import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

export interface FileOverlayProps {
	store: StoreApi<CabnStore>;
}

// Placeholder file viewer for M3 — full syntax highlighting, line numbers,
// and monster/annotation overlays are FileScene's job in M4. This exists so
// walking into a portal shows *something* real instead of a dead end.
export function FileOverlay({
	store,
}: FileOverlayProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const portalId = useCabnStore(store, (s) => s.activePortalId);
	const content = useCabnStore(store, (s) => s.activePortalContent);

	useEffect(() => {
		if (mode !== "file") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") store.getState().exitPortal();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [mode, store]);

	if (mode !== "file") return null;

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
				style={{
					width: "min(720px, 90vw)",
					maxHeight: "80vh",
					background: "#efe0b3",
					color: "#322214",
					border: "3px solid #322214",
					borderRadius: 8,
					display: "flex",
					flexDirection: "column",
					fontFamily: '"Courier New", monospace',
				}}
			>
				<div
					style={{
						padding: "10px 16px",
						borderBottom: "2px solid #322214",
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
					}}
				>
					{content ?? "(binary or unreadable file — no preview available)"}
				</pre>
			</div>
		</div>
	);
}
