import type { PortalFile } from "@cabn/world-schema";
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
import { uiSparklePath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { annotateFileLive } from "../systems/battle.js";
import { getActiveExecutionProvider } from "../systems/execution/executionProvider.js";
import { insertTextAt } from "../systems/insertText.js";
import {
	createIdleRunPlaybackState,
	currentStep,
	type RunPlaybackState,
	runPlaybackReducer,
} from "../systems/runPlayback.js";
import {
	type SpellbookErrorRow,
	spellbookStatusLine,
	toSpellbookErrorRows,
} from "../systems/spellbookStatus.js";
import { loadLanguageExtension } from "./editorLanguages.js";
import { pixelEditorExtensions } from "./editorTheme.js";
import { RunConsole, toRunConsoleSnapshot } from "./RunConsole.js";
import { useCabnStore } from "./useCabnStore.js";

export interface EditorOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

const BAG_SLOT_ALT_KEYS = ["1", "2", "3", "4", "5"];
const LIVE_ANNOTATE_DEBOUNCE_MS = 350;

// Open-burst sparks + drifting ink glyphs — violet, per STYLE.md's editor
// color pairing ("a small violet burst when the editor opens"). Positions
// mirror the approved mockup (mockup.html's #editor-burst/.glyph elements).
const OPEN_BURST_SPARKS: ReadonlyArray<{
	tx: number;
	ty: number;
	delayMs: number;
}> = [
	{ tx: -50, ty: -20, delayMs: 0 },
	{ tx: 50, ty: -20, delayMs: 70 },
];
const DRIFTING_GLYPHS: ReadonlyArray<{
	symbol: string;
	left: string;
	top: number;
	delayMs: number;
}> = [
	{ symbol: "{ }", left: "24px", top: 10, delayMs: 0 },
	{ symbol: "λ", left: "55%", top: 20, delayMs: 1100 },
	{ symbol: "%", left: "80%", top: 6, delayMs: 2200 },
];

const IDLE_RUN = createIdleRunPlaybackState();

/**
 * The spellbook: a two-page tome CodeMirror opens inside of, replacing the
 * old flat single-panel quill (playtest feedback: "editing/code running
 * feels a little clunky... we want the editors to feel part of the world but
 * still be fully functional"). Left page keeps every bit of the original
 * quill's behavior verbatim (mount/unmount on open/close, save, undo, bag
 * paste Alt+1-5, pixelEditorTheme, the monster defeat-by-fix loop via
 * `editor:save` -> FileScene.resolveMonstersAfterSave). Right page is new:
 * a live annotator error list (clickable line jumps) and an inline quick-run
 * console.
 *
 * Run/wand design decision (2026-09-28): this book's Ctrl/Cmd+Enter "Run"
 * does NOT reuse `mode: "run"`/RunOverlay's world-walking run — it drives its
 * own local `RunPlaybackState` (below), calling the same
 * `getActiveExecutionProvider()`/`runPlaybackReducer` pure systems FileScene
 * itself calls, but entirely in React. Two reasons: (1) FileScene's
 * `onWandUse` only starts a run from `mode === "file"` and owns the actual
 * state machine — scenes/ is out of scope for this pass, and mode:"run"
 * unmounts this overlay entirely (ToolHotbar/ EditorOverlay both hide for
 * it), which would defeat "the editor stays open while running"; (2) the
 * book's run is meant to be read, not walked through — no camera pan, no
 * world-monster blocking, just the trace/log. Running from the world without
 * opening the book (the wand hotbar/R, `mode: "file"`) is untouched and still
 * produces RunOverlay's full-screen literal spell-circle cast. Both read the
 * same trace/log data shape and share `RunConsole`'s controls, so the two
 * feel like the same spell cast at two different distances rather than two
 * unrelated features — but they are two separate state machines today. A
 * follow-up that wants the world's walking run triggerable *from* an open
 * book would need FileScene's own state machine extended to allow
 * `tool:wand-use` while `mode === "editor"`.
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
	// Remounting the book (key={playToken}) on every open is what retriggers
	// its CSS open animation — same "remount == retrigger" pattern every other
	// tool screen's open animation relies on.
	const [playToken, setPlayToken] = useState(0);

	const [errorRows, setErrorRows] = useState<SpellbookErrorRow[]>([]);
	const [localRun, setLocalRun] = useState<RunPlaybackState>(IDLE_RUN);
	const runRequestIdRef = useRef(0);

	const isOpen = mode === "editor";

	/** Runs the live annotators against `content` and republishes the right page's error list — called on open, on every debounced keystroke, and right after a save. */
	const recomputeErrors = useCallback(
		(content: string) => {
			const currentPortalId = portalIdRef.current;
			const { portals, editorLanguage } = store.getState();
			const portal = portals.find((p) => p.id === currentPortalId);
			if (!portal) {
				setErrorRows([]);
				return;
			}
			const file: PortalFile = {
				path: portal.path,
				name: portal.name,
				kind: portal.kind,
				language: editorLanguage,
				bytes: portal.bytes,
				binary: false,
			};
			const worldFiles = new Set(portals.map((p) => p.path));
			setErrorRows(
				toSpellbookErrorRows(annotateFileLive(file, content, worldFiles)),
			);
		},
		[store],
	);

	useEffect(() => {
		if (!isOpen || !hostRef.current || !portalId) return;

		const { activePortalContent, editorInitialLine, editorLanguage } =
			store.getState();
		const content = activePortalContent ?? "";
		let cancelled = false;
		let debounce: ReturnType<typeof setTimeout> | undefined;

		setDirty(false);
		setConfirmingDiscard(false);
		setPlayToken((token) => token + 1);
		setLocalRun(IDLE_RUN);
		recomputeErrors(content);

		loadLanguageExtension(editorLanguage).then((languageExtension) => {
			if (cancelled || !hostRef.current) return;

			const state = EditorState.create({
				doc: content,
				extensions: [
					keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
					history(),
					pixelEditorExtensions,
					...(languageExtension ? [languageExtension] : []),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return;
						setDirty(true);
						clearTimeout(debounce);
						const nextContent = update.state.doc.toString();
						debounce = setTimeout(
							() => recomputeErrors(nextContent),
							LIVE_ANNOTATE_DEBOUNCE_MS,
						);
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
			clearTimeout(debounce);
			viewRef.current?.destroy();
			viewRef.current = null;
		};
		// Only remounts on open/close (and if the store somehow hands us a
		// different portal while already open, which never happens today —
		// entering a new file always goes through closeEditor() first).
	}, [isOpen, portalId, store.getState, recomputeErrors]);

	// Stable across renders (refs, not the reactive `dirty`/`portalId` state)
	// so these can sit in effect dependency arrays without re-attaching their
	// listeners on every keystroke.
	const handleSave = useCallback(() => {
		const view = viewRef.current;
		const currentPortalId = portalIdRef.current;
		if (!view || !currentPortalId) return;
		const content = view.state.doc.toString();
		bus.emit("editor:save", { portalId: currentPortalId, content });
		setDirty(false);
		recomputeErrors(content);
	}, [bus, recomputeErrors]);

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

	const jumpToLine = useCallback((line: number) => {
		const view = viewRef.current;
		if (!view) return;
		const totalLines = view.state.doc.lines;
		const lineNumber = Math.min(Math.max(line + 1, 1), totalLines);
		const pos = view.state.doc.line(lineNumber).from;
		view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
		view.focus();
	}, []);

	/** Ctrl/Cmd+Enter (or the Run button) — see this file's own doc comment on why this is a separate, book-local run rather than `mode: "run"`. */
	const startInlineRun = useCallback(() => {
		const view = viewRef.current;
		const currentPortalId = portalIdRef.current;
		if (!view || !currentPortalId) return;
		const { portals, editorLanguage } = store.getState();
		const portal = portals.find((p) => p.id === currentPortalId);
		const requestId = ++runRequestIdRef.current;
		getActiveExecutionProvider()
			.run({
				content: view.state.doc.toString(),
				language: editorLanguage,
				filePath: portal?.path ?? currentPortalId,
			})
			.then((steps) => {
				if (requestId !== runRequestIdRef.current) return; // superseded/reset/closed
				if (steps.length === 0) return;
				setLocalRun(
					runPlaybackReducer(createIdleRunPlaybackState(), {
						type: "START",
						steps,
					}),
				);
			})
			.catch((err: unknown) => {
				console.error("cabn: spellbook run failed", err);
			});
	}, [store]);

	const resetInlineRun = useCallback(() => {
		runRequestIdRef.current++; // invalidate any in-flight run
		setLocalRun((prev) => runPlaybackReducer(prev, { type: "STOP" }));
	}, []);

	// The one tick source for the book's run — a rAF loop mirroring FileScene's
	// per-frame `updateRun`, just driven by the browser instead of Phaser's
	// scene loop since this run has no Phaser scene of its own.
	useEffect(() => {
		if (localRun.status !== "playing") return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const deltaMs = now - last;
			last = now;
			setLocalRun((prev) =>
				runPlaybackReducer(prev, { type: "TICK", deltaMs }),
			);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [localRun.status]);

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
			if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
				event.preventDefault();
				startInlineRun();
				return;
			}
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
	}, [
		isOpen,
		confirmingDiscard,
		handleSave,
		requestClose,
		pasteSlotById,
		startInlineRun,
	]);

	if (!isOpen) return null;

	const runIdle = localRun.steps.length === 0;
	const status = spellbookStatusLine({
		dirty,
		runStatus: runIdle ? "idle" : localRun.status,
		errorCount: errorRows.length,
	});
	const docLines = viewRef.current?.state.doc.toString().split("\n") ?? [];
	const runStep = currentStep(localRun);
	const runSourceLine = runStep ? (docLines[runStep.line - 1] ?? "") : "";

	return (
		<div
			style={{
				position: "absolute",
				// Same wider framing as the previous single-panel quill (2026-09-28
				// polish pass) — leaves the world visibly framed around every edge.
				inset: "36px 72px",
				zIndex: 8,
				display: "flex",
				flexDirection: "column",
				gap: 10,
				pointerEvents: "auto",
			}}
		>
			<div key={playToken} className="cabn-spellbook-spread">
				<div className="cabn-spellbook-ribbon" />
				<div className="cabn-spellbook-page left">
					<div className="cabn-spellbook-page-header">
						<span>
							{portalId ?? "(no file)"}
							{dirty && (
								<span
									style={{ marginLeft: 8, color: "var(--cabn-accent-yellow)" }}
								>
									●
								</span>
							)}
						</span>
					</div>
					<div style={{ position: "relative", flex: 1, minHeight: 0 }}>
						<div className="cabn-editor-ink-blot" />
						{DRIFTING_GLYPHS.map((g) => (
							<span
								key={g.symbol}
								className="cabn-editor-glyph"
								style={{
									left: g.left,
									top: g.top,
									animationDelay: `${g.delayMs}ms`,
								}}
							>
								{g.symbol}
							</span>
						))}
						<div ref={hostRef} style={{ height: "100%", overflow: "auto" }} />
						<div className="cabn-effect-burst play">
							{OPEN_BURST_SPARKS.map((s, i) => (
								// Fixed, static per-render burst layout, never reordered — index
								// is a stable enough key, same reasoning as RunConsole's log.
								<img
									// biome-ignore lint/suspicious/noArrayIndexKey: fixed, static list
									key={i}
									className="cabn-spark"
									src={uiSparklePath("violet")}
									alt=""
									style={
										{
											"--cabn-tx": `${s.tx}px`,
											"--cabn-ty": `${s.ty}px`,
											animationDelay: `${s.delayMs}ms`,
										} as React.CSSProperties
									}
								/>
							))}
						</div>
					</div>
				</div>
				<div className="cabn-spellbook-spine" />
				<div className="cabn-spellbook-page right">
					<div className="cabn-spellbook-page-header">
						<span>Errors ({errorRows.length})</span>
					</div>
					<div
						className="cabn-spellbook-errors"
						style={{ maxHeight: "34%", overflowY: "auto" }}
					>
						{errorRows.length === 0 ? (
							<div style={{ padding: "6px 4px", opacity: 0.7, fontSize: 12 }}>
								no annotator errors in this file
							</div>
						) : (
							<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
								{errorRows.map((row) => (
									<li key={row.key}>
										<button
											type="button"
											className="cabn-spellbook-error-row"
											disabled={row.line === undefined}
											onClick={() =>
												row.line !== undefined && jumpToLine(row.line)
											}
										>
											<span className="cabn-spellbook-error-line">
												{row.displayLine ?? "—"}
											</span>
											<span>{row.message}</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
					<div className="cabn-panel-divider" />
					<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
						{runIdle ? (
							<div
								style={{
									margin: "auto",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: 10,
								}}
							>
								<button
									type="button"
									className="cabn-btn confirm"
									onClick={startInlineRun}
								>
									Run
								</button>
								<span style={{ fontSize: 11, opacity: 0.7 }}>
									Ctrl/Cmd+Enter
								</span>
							</div>
						) : (
							<RunConsole
								run={toRunConsoleSnapshot(localRun)}
								sourceLine={runSourceLine}
								onPlayPause={() =>
									setLocalRun((prev) =>
										runPlaybackReducer(prev, {
											type: prev.status === "playing" ? "PAUSE" : "PLAY",
										}),
									)
								}
								onStep={() =>
									setLocalRun((prev) =>
										runPlaybackReducer(prev, { type: "STEP" }),
									)
								}
								onSetSpeed={(speed) =>
									setLocalRun((prev) =>
										runPlaybackReducer(prev, { type: "SET_SPEED", speed }),
									)
								}
								onStop={resetInlineRun}
								stopLabel="Reset"
							/>
						)}
					</div>
				</div>
			</div>
			<div className="cabn-spellbook-controls">
				<span className="cabn-spellbook-status">
					{status.summary} · Ctrl/Cmd+Enter run · Ctrl/Cmd+S save · Esc close ·
					Alt+1-5 paste bag slot
				</span>
				<div style={{ display: "flex", gap: 10 }}>
					<button
						type="button"
						className="cabn-btn cancel"
						onClick={requestClose}
						style={{ padding: "7px 16px" }}
					>
						Close
					</button>
					<button
						type="button"
						className="cabn-btn neutral"
						onClick={startInlineRun}
						style={{ padding: "7px 16px" }}
					>
						Run
					</button>
					<button
						type="button"
						className="cabn-btn confirm"
						onClick={handleSave}
						style={{ padding: "7px 16px" }}
					>
						Save
					</button>
				</div>
			</div>
			{battleHint && (
				<div
					className="cabn-panel"
					style={{
						position: "absolute",
						bottom: 60,
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
