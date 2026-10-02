import { useEffect, useMemo, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { fileCaretHints, isActiveFileDirty } from "../systems/fileBuffer.js";
import { detectMac } from "../systems/spellbookTools.js";
import { useCabnStore } from "./useCabnStore.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface FileStatusLineProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * The file view's status line (path, caret position, saved/unsaved, the
 * writing keybinds) and its "leave with unsaved changes?" prompt — the
 * inline caret's counterpart to the spellbook's own status bar.
 */
export function FileStatusLine({
	store,
	bus,
}: FileStatusLineProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const portalId = useCabnStore(store, (s) => s.activePortalId);
	const buffer = useCabnStore(store, (s) => s.activeFileState);
	const dirty = useCabnStore(store, isActiveFileDirty);
	const prompt = useCabnStore(store, (s) => s.fileLeavePrompt);
	const saveRef = useRef<HTMLButtonElement>(null);
	const promptRef = useRef<HTMLDivElement>(null);
	useFocusTrap(promptRef, prompt);
	const isMac = useMemo(
		() => detectMac(typeof navigator === "undefined" ? "" : navigator.platform),
		[],
	);

	useEffect(() => {
		if (!prompt) return;
		saveRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Same capture + preventDefault as SpyglassPanel's Esc.
			event.preventDefault();
			store.getState().setFileLeavePrompt(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [prompt, store]);

	if (mode !== "file" || !buffer || !portalId) return null;

	const head = buffer.selection.main.head;
	const line = buffer.doc.lineAt(head);
	const selected = buffer.selection.main.to - buffer.selection.main.from;

	return (
		<>
			<div
				className="cabn-panel cabn-hud-pill"
				data-testid="cabn-file-status"
				style={{
					position: "absolute",
					top: 16,
					left: "50%",
					transform: "translateX(-50%)",
					zIndex: 5,
					fontSize: 12,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 2,
					maxWidth: "min(760px, 70vw)",
					pointerEvents: "none",
				}}
			>
				<span>
					<strong>{portalId}</strong>
					{" · "}
					<span data-testid="cabn-file-save-state">
						{dirty ? (
							// --cabn-warn-ink, not the raw accent-yellow: a compact status
							// marker, treated as a UI glyph (WCAG 1.4.11, 3:1) rather than
							// body text — plain accent-yellow cleared only 1.35:1 on day's
							// near-white panel (uiContrast.test.ts).
							<span style={{ color: "var(--cabn-warn-ink)" }}>● unsaved</span>
						) : (
							"saved"
						)}
					</span>
					{` · Ln ${line.number}, Col ${head - line.from + 1}`}
					{selected > 0 ? ` (${selected} selected)` : ""}
				</span>
				<span style={{ opacity: 0.75, fontSize: 11 }}>
					{fileCaretHints(isMac)}
				</span>
			</div>
			{prompt && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						background: "rgba(20, 16, 40, 0.55)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 12,
						pointerEvents: "auto",
					}}
				>
					<div
						ref={promptRef}
						className="cabn-panel"
						role="alertdialog"
						aria-modal="true"
						aria-label="Unsaved changes"
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 12,
							alignItems: "center",
						}}
					>
						<span>Unsaved changes in {portalId}</span>
						<div style={{ display: "flex", gap: 10 }}>
							<button
								ref={saveRef}
								type="button"
								className="cabn-btn confirm"
								onClick={() => bus.emit("file:leave", { save: true })}
								style={{ padding: "6px 14px" }}
							>
								Save & leave
							</button>
							<button
								type="button"
								className="cabn-btn cancel"
								onClick={() => bus.emit("file:leave", { save: false })}
								style={{ padding: "6px 14px" }}
							>
								Discard
							</button>
							<button
								type="button"
								className="cabn-btn neutral"
								onClick={() => store.getState().setFileLeavePrompt(false)}
								style={{ padding: "6px 14px" }}
							>
								Keep writing
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
