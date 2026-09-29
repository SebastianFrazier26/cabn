import type { PortalFile } from "@cabn/world-schema";
import {
	defaultKeymap,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import {
	EditorSelection,
	type EditorState,
	type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { uiSparklePath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { annotateFileLive } from "../systems/battle.js";
import {
	type OutlineSymbol,
	outlineSymbols,
} from "../systems/editorOutline.js";
import {
	isValidIdentifier,
	planRename,
	type RenameOccurrence,
	wordAt,
} from "../systems/editorRename.js";
import { getActiveExecutionProvider } from "../systems/execution/executionProvider.js";
import {
	createFileBufferState,
	isActiveFileDirty,
	saveActiveFile,
	spellbookCompartment,
} from "../systems/fileBuffer.js";
import { insertTextAt } from "../systems/insertText.js";
import { lineMapper } from "../systems/lineAnchors.js";
import {
	createIdleRunPlaybackState,
	currentStep,
	type RunPlaybackState,
	runPlaybackReducer,
} from "../systems/runPlayback.js";
import {
	mapSpellbookErrorRows,
	type SpellbookErrorRow,
	spellbookStatusLine,
	toSpellbookErrorRows,
} from "../systems/spellbookStatus.js";
import {
	detectMac,
	type SpellbookToolId,
	toolForKey,
} from "../systems/spellbookTools.js";
import { loadLanguageExtension } from "./editorLanguages.js";
import { pixelEditorExtensions } from "./editorTheme.js";
import {
	applyRenameInView,
	nonCodeRangesFor,
	runEditorCommand,
	spellbookToolExtensions,
} from "./editorTools.js";
import { PetProposalReview } from "./PetProposalReview.js";
import { RunConsole, toRunConsoleSnapshot } from "./RunConsole.js";
import {
	GoToLineDialog,
	RenameDialog,
	SymbolPicker,
} from "./SpellbookDialogs.js";
import { SpellbookToolbar } from "./SpellbookToolbar.js";
import { useCabnStore } from "./useCabnStore.js";

export interface EditorOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

const BAG_SLOT_ALT_KEYS = ["1", "2", "3", "4", "5"];
const LIVE_ANNOTATE_DEBOUNCE_MS = 350;

// Open-burst sparks + border motes — violet, per STYLE.md's editor color
// pairing ("a small violet burst when the editor opens"). Round-2 playtest
// (2026-09-28): the motes used to cluster at the top of the left page, over
// the code; they now sit on the book's own frame — the four edges, the four
// corners and the spine gutter — which never overlaps either page's text.
const OPEN_BURST_SPARKS: ReadonlyArray<{
	left: string;
	top: string;
	tx: number;
	ty: number;
	delayMs: number;
}> = [
	{ left: "0%", top: "0%", tx: -26, ty: -22, delayMs: 0 },
	{ left: "100%", top: "0%", tx: 26, ty: -22, delayMs: 60 },
	{ left: "100%", top: "100%", tx: 26, ty: 22, delayMs: 120 },
	{ left: "0%", top: "100%", tx: -26, ty: 22, delayMs: 180 },
];

type BorderMote = {
	/** A glyph, or null for a sparkle sprite. */
	symbol: string | null;
	/** Positioned inside the spine element rather than the whole frame — the right page's padding makes the spine sit off the frame's true 50%. */
	spine?: true;
	left: string;
	top: string;
	delayMs: number;
};
const BORDER_MOTES: readonly BorderMote[] = [
	// Corners.
	{ symbol: null, left: "0%", top: "0%", delayMs: 0 },
	{ symbol: null, left: "100%", top: "0%", delayMs: 900 },
	{ symbol: null, left: "100%", top: "100%", delayMs: 1800 },
	{ symbol: null, left: "0%", top: "100%", delayMs: 2700 },
	// Top edge (skipping the ribbon bookmark at ~26%).
	{ symbol: "{ }", left: "12%", top: "0%", delayMs: 400 },
	{ symbol: null, left: "42%", top: "0%", delayMs: 2100 },
	{ symbol: "λ", left: "71%", top: "0%", delayMs: 1300 },
	// Bottom edge.
	{ symbol: null, left: "18%", top: "100%", delayMs: 1500 },
	{ symbol: "%", left: "37%", top: "100%", delayMs: 300 },
	{ symbol: null, left: "63%", top: "100%", delayMs: 2400 },
	{ symbol: "✦", left: "86%", top: "100%", delayMs: 1000 },
	// Left and right edges.
	{ symbol: "λ", left: "0%", top: "34%", delayMs: 1900 },
	{ symbol: null, left: "0%", top: "68%", delayMs: 600 },
	{ symbol: null, left: "100%", top: "28%", delayMs: 2600 },
	{ symbol: "{ }", left: "100%", top: "62%", delayMs: 800 },
	// Spine gutter.
	{ symbol: "✦", left: "50%", top: "30%", delayMs: 1200, spine: true },
	{ symbol: null, left: "50%", top: "74%", delayMs: 200, spine: true },
];

function Mote({ mote }: { mote: BorderMote }): React.ReactElement {
	return (
		<span
			className={`cabn-spellbook-mote${mote.symbol ? " glyph" : ""}`}
			style={{
				left: mote.left,
				top: mote.top,
				animationDelay: `${mote.delayMs}ms`,
			}}
		>
			{mote.symbol ?? <img src={uiSparklePath("violet")} alt="" />}
		</span>
	);
}

const IDLE_RUN = createIdleRunPlaybackState();
const TOOL_HINT_MS = 2400;

type SpellbookDialog =
	| { kind: "goto" }
	| { kind: "symbol"; symbols: OutlineSymbol[] }
	| {
			kind: "rename";
			oldName: string;
			occurrences: RenameOccurrence[];
			caretFrom: number;
	  };

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
	const rootRef = useRef<HTMLDivElement>(null);
	const consumedInBookRef = useRef(new WeakSet<KeyboardEvent>());
	const viewRef = useRef<EditorView | null>(null);
	const bagSlotsRef = useRef(bagSlots);
	bagSlotsRef.current = bagSlots;
	const portalIdRef = useRef(portalId);
	portalIdRef.current = portalId;

	// The document is the store's shared file buffer (systems/fileBuffer.ts),
	// not a copy: the view is built from it on open, every transaction is
	// published back, and closing leaves unsaved edits in place for the file
	// view's inline caret — so closing no longer asks to discard (leaving the
	// file does).
	const dirty = useCabnStore(store, isActiveFileDirty);
	/** The state this view last published to the store — anything else arriving there (a reset to pristine) is pushed into the view. */
	const publishedRef = useRef<EditorState | null>(null);
	const bookExtensionsRef = useRef<Extension>([]);
	const [battleHint, setBattleHint] = useState<string | null>(null);
	// Remounting the book (key={playToken}) on every open is what retriggers
	// its CSS open animation — same "remount == retrigger" pattern every other
	// tool screen's open animation relies on.
	const [playToken, setPlayToken] = useState(0);

	const [errorRows, setErrorRows] = useState<SpellbookErrorRow[]>([]);
	const [localRun, setLocalRun] = useState<RunPlaybackState>(IDLE_RUN);
	const runRequestIdRef = useRef(0);
	const [dialog, setDialog] = useState<SpellbookDialog | null>(null);
	const dialogRef = useRef(dialog);
	dialogRef.current = dialog;
	const [toolHint, setToolHint] = useState<string | null>(null);
	const isMac = useMemo(
		() => detectMac(typeof navigator === "undefined" ? "" : navigator.platform),
		[],
	);
	// The CM keymap is built once per open, so it calls through this ref to
	// reach the current render's handler instead of a stale closure.
	const handleToolRef = useRef<(id: SpellbookToolId) => void>(() => {});

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

		const openedPortalId = portalId;
		const { activePortalContent, activeFileState, editorLanguage } =
			store.getState();
		const shared =
			activeFileState ?? createFileBufferState(activePortalContent ?? "");
		const content = shared.doc.toString();
		let cancelled = false;
		let debounce: ReturnType<typeof setTimeout> | undefined;

		setPlayToken((token) => token + 1);
		setLocalRun(IDLE_RUN);
		setDialog(null);
		setToolHint(null);
		recomputeErrors(content);

		loadLanguageExtension(editorLanguage).then((languageExtension) => {
			if (cancelled || !hostRef.current) return;

			const bookExtensions: Extension = [
				spellbookToolExtensions(
					editorLanguage,
					languageExtension !== null,
					content,
					{
						onTool: (id) => handleToolRef.current(id),
						onNote: setToolHint,
					},
				),
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				pixelEditorExtensions,
				...(languageExtension ? [languageExtension] : []),
				EditorView.updateListener.of((update) => {
					if (update.docChanged || update.selectionSet) {
						publishedRef.current = update.state;
						store.getState().setActiveFileState(update.state);
					}
					if (!update.docChanged) return;
					const mapLine = lineMapper(
						update.startState.doc,
						update.state.doc,
						update.changes,
					);
					setErrorRows((rows) => mapSpellbookErrorRows(rows, mapLine));
					// Rename's preview holds document offsets; any edit makes them stale.
					if (dialogRef.current?.kind === "rename") setDialog(null);
					clearTimeout(debounce);
					const nextContent = update.state.doc.toString();
					debounce = setTimeout(
						() => recomputeErrors(nextContent),
						LIVE_ANNOTATE_DEBOUNCE_MS,
					);
				}),
			];
			bookExtensionsRef.current = bookExtensions;
			// Re-read: the language pack loads async, and the buffer may have moved on.
			const latest = store.getState().activeFileState ?? shared;
			const state = latest.update({
				effects: spellbookCompartment.reconfigure(bookExtensions),
			}).state;
			publishedRef.current = state;
			store.getState().setActiveFileState(state);
			const view = new EditorView({ state, parent: hostRef.current });
			view.dispatch({
				effects: EditorView.scrollIntoView(state.selection.main.head, {
					y: "center",
				}),
			});
			view.focus();

			viewRef.current = view;
		});

		return () => {
			cancelled = true;
			clearTimeout(debounce);
			// Detached first, so the store->view sync below ignores this write.
			const view = viewRef.current;
			const published = publishedRef.current;
			viewRef.current = null;
			publishedRef.current = null;
			const s = store.getState();
			if (
				view &&
				s.activePortalId === openedPortalId &&
				s.activeFileState === published
			) {
				s.setActiveFileState(
					view.state.update({ effects: spellbookCompartment.reconfigure([]) })
						.state,
				);
			}
			view?.destroy();
		};
		// Only remounts on open/close (and if the store somehow hands us a
		// different portal while already open, which never happens today —
		// entering a new file always goes through closeEditor() first).
	}, [isOpen, portalId, store.getState, recomputeErrors]);

	// A buffer change that didn't come from this view — the spyglass's
	// "reset this file" swapping in pristine text — replaces the view's state
	// so the two never diverge.
	useEffect(() => {
		if (!isOpen) return;
		return store.subscribe((s) => {
			const view = viewRef.current;
			const next = s.activeFileState;
			if (!view || !next || next === publishedRef.current) return;
			const state = next.update({
				effects: spellbookCompartment.reconfigure(bookExtensionsRef.current),
			}).state;
			publishedRef.current = state;
			view.setState(state);
			s.setActiveFileState(state);
			recomputeErrors(state.doc.toString());
		});
	}, [isOpen, store, recomputeErrors]);

	// Stable across renders (refs, not reactive state) so these can sit in
	// effect dependency arrays without re-attaching their listeners on every
	// keystroke.
	const handleSave = useCallback(() => {
		const view = viewRef.current;
		if (!view) return;
		saveActiveFile(store, bus);
		recomputeErrors(view.state.doc.toString());
	}, [store, bus, recomputeErrors]);

	const requestClose = useCallback(() => {
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

	useEffect(() => {
		if (!toolHint) return;
		const timeout = setTimeout(() => setToolHint(null), TOOL_HINT_MS);
		return () => clearTimeout(timeout);
	}, [toolHint]);

	const closeDialog = useCallback(() => {
		setDialog(null);
		viewRef.current?.focus();
	}, []);

	const openRename = useCallback(() => {
		const view = viewRef.current;
		const currentPortalId = portalIdRef.current;
		if (!view || !currentPortalId) return;
		const { editorLanguage } = store.getState();
		const text = view.state.doc.toString();
		const { main } = view.state.selection;
		// Always the whole identifier: a find-selected "Record" inside
		// "HarvestRecord" renames HarvestRecord, not a substring nobody declared.
		const target = wordAt(
			text,
			main.empty ? main.head : main.from,
			editorLanguage,
		);
		if (!target.word || !isValidIdentifier(target.word, editorLanguage)) {
			setToolHint("Put the caret on a name to rename it");
			return;
		}
		const plan = planRename(
			[{ path: currentPortalId, text, excluded: nonCodeRangesFor(view.state) }],
			target.word,
			target.word,
			editorLanguage,
		);
		const occurrences = plan.files[0]?.occurrences ?? [];
		if (occurrences.length === 0) {
			setToolHint(`"${target.word}" only appears in strings or comments here`);
			return;
		}
		setDialog({
			kind: "rename",
			oldName: target.word,
			occurrences,
			caretFrom:
				occurrences.find((o) => main.head >= o.from && main.head <= o.to)
					?.from ?? -1,
		});
	}, [store]);

	const goToPosition = useCallback(
		(line: number, column: number, length = 0) => {
			const view = viewRef.current;
			if (!view) return;
			const lineNumber = Math.min(Math.max(line + 1, 1), view.state.doc.lines);
			const docLine = view.state.doc.line(lineNumber);
			const anchor = docLine.from + Math.min(column, docLine.length);
			view.dispatch({
				selection: EditorSelection.single(anchor, anchor + length),
				effects: EditorView.scrollIntoView(anchor, { y: "center" }),
			});
			view.focus();
		},
		[],
	);

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

	const handleTool = useCallback(
		(id: SpellbookToolId) => {
			const view = viewRef.current;
			if (!view) return;
			switch (id) {
				case "run":
					startInlineRun();
					return;
				case "save":
					handleSave();
					return;
				case "rename":
					openRename();
					return;
				case "goto":
					setDialog({ kind: "goto" });
					return;
				case "symbol":
					setDialog({
						kind: "symbol",
						symbols: outlineSymbols(
							view.state.doc.toString(),
							store.getState().editorLanguage,
						),
					});
					return;
				default:
					setDialog(null);
					runEditorCommand(
						id,
						view,
						store.getState().editorLanguage,
						setToolHint,
					);
					// The replace panel focuses its own input; everything else acts on the doc.
					if (id !== "find" && id !== "replace") view.focus();
			}
		},
		[startInlineRun, handleSave, openRename, store],
	);
	handleToolRef.current = handleTool;

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

	// Keys already handled inside the book — CodeMirror's keymap (toolbar
	// bindings, the search panel's own Esc) or a dialog's Esc/Enter — are
	// recorded as they bubble through the book's root, before reaching the
	// window listener below. `event.defaultPrevented` alone can't tell them
	// apart there: Phaser's KeyboardManager (also on window, registered
	// earlier) preventDefault()s its captured keys like Esc whenever focus
	// is outside a text field, and that must not swallow Esc-to-close. The
	// target can't be checked either — closing a panel detaches it first.
	useEffect(() => {
		const root = rootRef.current;
		if (!isOpen || !root) return;
		const onBookKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) consumedInBookRef.current.add(event);
		};
		root.addEventListener("keydown", onBookKeyDown);
		return () => root.removeEventListener("keydown", onBookKeyDown);
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (consumedInBookRef.current.has(event)) return;
			// Fallback for when focus isn't inside the editor (a dialog, the
			// run console's buttons) — also stops Cmd/Ctrl+F reaching the
			// browser's own find bar.
			const tool = toolForKey(event, isMac);
			if (tool) {
				event.preventDefault();
				handleTool(tool.id);
				return;
			}
			if (event.key === "Escape") {
				if (dialogRef.current) {
					closeDialog();
				} else {
					requestClose();
				}
				return;
			}
			if (event.altKey) {
				// Physical digit, not event.key: Option+1 on macOS types "¡".
				const index = BAG_SLOT_ALT_KEYS.indexOf(
					event.code.replace("Digit", ""),
				);
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
	}, [isOpen, requestClose, pasteSlotById, handleTool, closeDialog, isMac]);

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
			ref={rootRef}
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
			<SpellbookToolbar isMac={isMac} onTool={handleTool} />
			<div key={playToken} className="cabn-spellbook-frame">
				<div className="cabn-spellbook-spread">
					<div className="cabn-spellbook-ribbon" />
					<div className="cabn-spellbook-page left">
						<div className="cabn-spellbook-page-header">
							<span>
								{portalId ?? "(no file)"}
								{dirty && (
									<span
										style={{
											marginLeft: 8,
											color: "var(--cabn-accent-yellow)",
										}}
									>
										●
									</span>
								)}
							</span>
						</div>
						<div style={{ position: "relative", flex: 1, minHeight: 0 }}>
							<div ref={hostRef} style={{ height: "100%", overflow: "auto" }} />
							{dialog?.kind === "goto" && viewRef.current && (
								<GoToLineDialog
									totalLines={viewRef.current.state.doc.lines}
									currentLine={
										viewRef.current.state.doc.lineAt(
											viewRef.current.state.selection.main.head,
										).number
									}
									onGo={(line, column) => {
										setDialog(null);
										goToPosition(line, column);
									}}
									onClose={closeDialog}
								/>
							)}
							{dialog?.kind === "symbol" && (
								<SymbolPicker
									symbols={dialog.symbols}
									onPick={(symbol) => {
										setDialog(null);
										const lineText =
											viewRef.current?.state.doc.line(symbol.line + 1).text ??
											"";
										const column = Math.max(lineText.indexOf(symbol.name), 0);
										goToPosition(symbol.line, column, symbol.name.length);
									}}
									onClose={closeDialog}
								/>
							)}
							{dialog?.kind === "rename" && (
								<RenameDialog
									oldName={dialog.oldName}
									language={store.getState().editorLanguage}
									occurrences={dialog.occurrences}
									caretFrom={dialog.caretFrom}
									onApply={(selected, newName) => {
										setDialog(null);
										const view = viewRef.current;
										if (!view) return;
										applyRenameInView(view, selected, newName);
										setToolHint(
											`Renamed ${selected.length} × ${dialog.oldName} → ${newName}`,
										);
										view.focus();
									}}
									onClose={closeDialog}
								/>
							)}
							{toolHint && (
								<div className="cabn-spellbook-tool-hint">{toolHint}</div>
							)}
						</div>
					</div>
					<div className="cabn-spellbook-spine" aria-hidden="true">
						{BORDER_MOTES.filter((m) => m.spine).map((m) => (
							<Mote key={`${m.left}-${m.top}`} mote={m} />
						))}
					</div>
					<div
						className="cabn-spellbook-page right"
						style={{ position: "relative" }}
					>
						<PetProposalReview store={store} />
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
				<div className="cabn-spellbook-motes" aria-hidden="true">
					{BORDER_MOTES.filter((m) => !m.spine).map((m) => (
						<Mote key={`${m.left}-${m.top}`} mote={m} />
					))}
				</div>
				<div className="cabn-effect-burst play">
					{OPEN_BURST_SPARKS.map((s) => (
						<img
							key={`${s.left}-${s.top}`}
							className="cabn-spark"
							src={uiSparklePath("violet")}
							alt=""
							style={
								{
									left: s.left,
									top: s.top,
									"--cabn-tx": `${s.tx}px`,
									"--cabn-ty": `${s.ty}px`,
									animationDelay: `${s.delayMs}ms`,
								} as React.CSSProperties
							}
						/>
					))}
				</div>
			</div>
			<div className="cabn-spellbook-controls">
				<span className="cabn-spellbook-status">
					{status.summary} · Esc back to the page (edits kept) · Alt+1-5 paste
					bag slot · hover a tool for its shortcut
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
		</div>
	);
}
