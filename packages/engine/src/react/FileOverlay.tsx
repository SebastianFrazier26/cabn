import { useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { type DisplayPreview, tableFromText } from "../systems/archPreview.js";
import { CSV_DEFAULT_MAX_ROWS } from "../systems/csv.js";
import { CsvTable } from "./MediaViewers.js";
import { PortalPreview } from "./PortalPreview.js";
import { useCabnStore } from "./useCabnStore.js";

export interface FileOverlayProps {
	store: StoreApi<CabnStore>;
}

const MEDIA_KINDS = new Set<DisplayPreview["kind"]>([
	"image",
	"audio",
	"pdf",
	"sealed",
]);

// M4: FileScene (a real walkable scroll world, see scenes/FileScene.ts) is
// now the file viewer for anything with text content. This overlay's job
// shrinks to what it can't do: a binary file (activePortalContent === null)
// has nothing for FileScene to render, so WorldScene never launches it and
// mode just flips to "file" with no content — this is that view, which now
// shows the image/audio/PDF viewer (or the sealed chest's name and size).
// A CSV/TSV does open in FileScene; it additionally gets a table panel here.
export function FileOverlay({
	store,
}: FileOverlayProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const portalId = useCabnStore(store, (s) => s.activePortalId);
	const content = useCabnStore(store, (s) => s.activePortalContent);
	const preview = useCabnStore(store, (s) => s.activePortalPreview);
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const isBinaryFallback = mode === "file" && content === null;

	useEffect(() => {
		if (!isBinaryFallback) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") store.getState().exitPortal();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isBinaryFallback, store]);

	if (
		mode === "file" &&
		content !== null &&
		preview?.kind === "table" &&
		portalId
	) {
		return <FileTablePanel path={portalId} content={content} />;
	}

	if (!isBinaryFallback) return null;
	const fileName = portalId?.split("/").pop() ?? "(unknown file)";
	const showMedia =
		preview !== null && MEDIA_KINDS.has(preview.kind) && worldBase !== null;

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
				pointerEvents: "auto",
			}}
		>
			<div
				className="cabn-panel"
				data-testid="cabn-file-media-view"
				style={{
					width: "min(720px, 90vw)",
					height: showMedia ? "min(560px, 80vh)" : undefined,
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
				{showMedia ? (
					<div style={{ flex: 1, minHeight: 0, padding: 12 }}>
						<PortalPreview
							preview={preview}
							fileName={fileName}
							worldBaseUrl={worldBase}
							variant="expanded"
							bare
							store={store}
						/>
					</div>
				) : (
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
				)}
			</div>
		</div>
	);
}

/** The whole file (not just the arch's first rows), parsed once per open, docked beside the walkable scroll; collapsible so it never blocks the scroll world. */
function FileTablePanel({
	path,
	content,
}: {
	path: string;
	content: string;
}): React.ReactElement {
	const [open, setOpen] = useState(true);
	const table = useMemo(
		() => tableFromText(content, path, CSV_DEFAULT_MAX_ROWS),
		[content, path],
	);
	return (
		<div
			data-testid="cabn-file-table-panel"
			style={{
				position: "absolute",
				right: 16,
				top: 16,
				bottom: 96,
				width: open ? "min(460px, 44vw)" : "auto",
				display: "flex",
				flexDirection: "column",
				pointerEvents: "auto",
				zIndex: 5,
			}}
		>
			<div
				className="cabn-panel"
				style={{
					boxSizing: "border-box",
					height: open ? "100%" : "auto",
					display: "flex",
					flexDirection: "column",
					padding: 10,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						gap: 8,
						marginBottom: open ? 6 : 0,
					}}
				>
					<span className="cabn-panel-title" style={{ margin: 0 }}>
						{open ? "Table" : "▦"}
					</span>
					<button
						type="button"
						className="cabn-pill-button"
						onClick={() => setOpen((o) => !o)}
						aria-label={open ? "Hide table" : "Show table"}
					>
						{open ? "hide ▸" : "◂ table"}
					</button>
				</div>
				{open && (
					<div style={{ flex: 1, minHeight: 0 }}>
						<CsvTable rows={table.rows} truncated={table.truncated} />
					</div>
				)}
			</div>
		</div>
	);
}
