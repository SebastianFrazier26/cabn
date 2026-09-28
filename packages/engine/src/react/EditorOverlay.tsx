import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { insertTextAt } from "../systems/insertText.js";
import { loadLanguageExtension } from "./editorLanguages.js";
import { cottagecoreEditorExtensions } from "./editorTheme.js";
import { useCabnStore } from "./useCabnStore.js";

export interface EditorOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

const BAG_SLOT_ALT_KEYS = ["1", "2", "3", "4", "5"];

/**
 * The quill: a CodeMirror 6 panel over the open file. Mounts/unmounts its
 * `EditorView` on `mode` transitions rather than tracking `activePortalContent`
 * as a dep — the editor owns the buffer once open (its own doc, not a
 * store-mirrored one), so a store update from elsewhere (our own save
 * round-trip) must never blow away in-progress keystrokes.
 */
export function EditorOverlay({
	store,
	bus,
}: EditorOverlayProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const portalId = useCabnStore(store, (s) => s.activePortalId);
	const bagSlots = useCabnStore(store, (s) => s.bagSlots);

	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const bagSlotsRef = useRef(bagSlots);
	bagSlotsRef.current = bagSlots;
	const portalIdRef = useRef(portalId);
	portalIdRef.current = portalId;

	const [dirty, setDirty] = useState(false);
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);
	const [battleHint, setBattleHint] = useState<string | null>(null);

	const isOpen = mode === "editor";

	useEffect(() => {
		if (!isOpen || !hostRef.current || !portalId) return;

		const { activePortalContent, editorInitialLine, editorLanguage } =
			store.getState();
		const content = activePortalContent ?? "";
		let cancelled = false;

		setDirty(false);
		setConfirmingDiscard(false);

		loadLanguageExtension(editorLanguage).then((languageExtension) => {
			if (cancelled || !hostRef.current) return;

			const state = EditorState.create({
				doc: content,
				extensions: [
					keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
					history(),
					cottagecoreEditorExtensions,
					...(languageExtension ? [languageExtension] : []),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) setDirty(true);
					}),
				],
			});
			const view = new EditorView({ state, parent: hostRef.current });

			const totalLines = view.state.doc.lines;
			const lineNumber = Math.min(
				Math.max(editorInitialLine + 1, 1),
				totalLines,
			);
			const caretPos = view.state.doc.line(lineNumber).from;
			view.dispatch({
				selection: { anchor: caretPos },
				scrollIntoView: true,
			});
			view.focus();

			viewRef.current = view;
		});

		return () => {
			cancelled = true;
			viewRef.current?.destroy();
			viewRef.current = null;
		};
		// Only remounts on open/close (and if the store somehow hands us a
		// different portal while already open, which never happens today —
		// entering a new file always goes through closeEditor() first).
	}, [isOpen, portalId, store.getState]);

	// Stable across renders (refs, not the reactive `dirty`/`portalId` state)
	// so these can sit in effect dependency arrays without re-attaching their
	// listeners on every keystroke.
	const handleSave = useCallback(() => {
		const view = viewRef.current;
		const currentPortalId = portalIdRef.current;
		if (!view || !currentPortalId) return;
		bus.emit("editor:save", {
			portalId: currentPortalId,
			content: view.state.doc.toString(),
		});
		setDirty(false);
	}, [bus]);

	const requestClose = useCallback(() => {
		if (dirtyRef.current) {
			setConfirmingDiscard(true);
			return;
		}
		store.getState().closeEditor();
	}, [store]);

	const pasteSlotById = useCallback((slotId: string) => {
		const view = viewRef.current;
		const slot = bagSlotsRef.current.find((s) => s.id === slotId);
		if (!view || !slot) return;
		const doc = view.state.doc.toString();
		const cursor = view.state.selection.main.head;
		const { text, cursor: nextCursor } = insertTextAt(doc, cursor, slot.text);
		view.dispatch({
			changes: { from: 0, to: doc.length, insert: text },
			selection: { anchor: nextCursor },
		});
		view.focus();
	}, []);

	useEffect(() => {
		if (!isOpen) return;
		const onPasteSlot = ({ slotId }: { slotId: string }) =>
			pasteSlotById(slotId);
		bus.on("editor:paste-slot", onPasteSlot);
		return () => bus.off("editor:paste-slot", onPasteSlot);
	}, [isOpen, bus, pasteSlotById]);

	// FileScene emits this after a save during an encounter that didn't fix the
	// encountered monster (the shrug/shake animation plays behind this overlay
	// — the editor stays open so the player can keep trying) — a transient
	// toast, not tied to `dirty`/save state at all.
	useEffect(() => {
		if (!isOpen) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const onHint = ({ message }: { message: string }) => {
			clearTimeout(timeout);
			setBattleHint(message);
			timeout = setTimeout(() => setBattleHint(null), 2600);
		};
		bus.on("battle:hint", onHint);
		return () => {
			clearTimeout(timeout);
			bus.off("battle:hint", onHint);
		};
	}, [isOpen, bus]);

	useEffect(() => {
		if (!isOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				handleSave();
				return;
			}
			if (event.key === "Escape") {
				if (confirmingDiscard) {
					setConfirmingDiscard(false); // second Esc backs out of the confirm, not a second discard
				} else {
					requestClose();
				}
				return;
			}
			if (event.altKey) {
				const index = BAG_SLOT_ALT_KEYS.indexOf(event.key);
				if (index !== -1) {
					const slot = bagSlotsRef.current[index];
					if (slot) {
						event.preventDefault();
						pasteSlotById(slot.id);
					}
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isOpen, confirmingDiscard, handleSave, requestClose, pasteSlotById]);

	if (!isOpen) return null;

	return (
		<div
			className="cabn-panel"
			style={{
				position: "absolute",
				inset: "24px 24px 24px 24px",
				zIndex: 8,
				display: "flex",
				flexDirection: "column",
				padding: 0,
				overflow: "hidden",
				pointerEvents: "auto",
			}}
		>
			<div
				style={{
					position: "relative",
					zIndex: 1,
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "8px 16px",
					background: "var(--cabn-border-outer)",
					color: "#fff",
				}}
			>
				<span>
					{portalId ?? "(no file)"}
					{dirty && (
						<span style={{ marginLeft: 8, color: "var(--cabn-accent-yellow)" }}>
							●
						</span>
					)}
				</span>
				<span style={{ fontSize: 12, opacity: 0.75 }}>
					Ctrl/Cmd-S save · Esc close · Alt+1-5 paste bag slot
				</span>
			</div>
			<div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: "auto" }} />
			{battleHint && (
				<div
					className="cabn-panel"
					style={{
						position: "absolute",
						bottom: 14,
						left: "50%",
						transform: "translateX(-50%)",
						fontSize: 13,
						maxWidth: "70%",
						textAlign: "center",
					}}
				>
					{battleHint}
				</div>
			)}
			{confirmingDiscard && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						background: "rgba(20, 16, 40, 0.55)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						pointerEvents: "auto",
					}}
				>
					<div
						className="cabn-panel"
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 12,
							alignItems: "center",
						}}
					>
						<span>Discard unsaved changes?</span>
						<div style={{ display: "flex", gap: 10 }}>
							<button
								type="button"
								className="cabn-btn cancel"
								onClick={() => store.getState().closeEditor()}
								style={{ padding: "6px 14px" }}
							>
								Discard
							</button>
							<button
								type="button"
								className="cabn-btn neutral"
								onClick={() => setConfirmingDiscard(false)}
								style={{ padding: "6px 14px" }}
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
