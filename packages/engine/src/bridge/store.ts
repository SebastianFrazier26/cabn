import type {
	FileKind,
	Position,
	SignEntry,
	Species,
} from "@cabn/world-schema";
import { isolateHistory } from "@codemirror/commands";
import {
	EditorSelection,
	type EditorState,
	type Text,
} from "@codemirror/state";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DisplayPreview } from "../systems/archPreview.js";
import { addBagSlot, type BagSlot, removeBagSlot } from "../systems/bag.js";
import { createFileBufferState } from "../systems/fileBuffer.js";
import type { OwnerSignsApi } from "../systems/ownerSigns.js";
import type { RunSpeed, RunStatus } from "../systems/runPlayback.js";
import {
	resolveTimeOfDay,
	type TimeOfDay,
	type TimeOfDayOverride,
} from "../systems/timeOfDay.js";
import type { WorldMapSummary } from "../systems/worldMap.js";

export type CabnMode = "world" | "file" | "editor" | "encounter" | "run";

/** The parchment overlay's own read of FileScene's runPlayback state — a snapshot, same "React never touches Phaser-owned state directly" shape as PortalSummary/MonsterSummary above. FileScene owns the actual `RunPlaybackState` and republishes one of these on every tick. */
export interface RunOverlayState {
	totalSteps: number;
	index: number;
	currentLine: number;
	status: RunStatus;
	speed: RunSpeed;
	log: string[];
	blockedMessage?: string;
	/** True for a LocalRunProvider run of JS/TS source (no real line tracing available — see cabn serve's docs) — the overlay labels line numbers "approximate" instead of implying exact stepping. Always false for TraceProvider (the default, and only provider in a hosted build). */
	approximateLines: boolean;
}

/** Flat, per-monster summary WorldScene fills once at create() — same shape/reasoning as PortalSummary below (the HUD counter and FileScene's encounter banner read this instead of holding their own copy of the manifest). */
export interface MonsterSummary {
	id: string;
	species: Species;
	message: string;
	tier: number;
	portalId?: string;
	pathId?: string;
}

/** Flat, per-portal summary WorldScene fills once at create() — backs both the spyglass panel and the orb's world-search result list, so neither needs its own copy of the manifest. */
export interface PortalSummary {
	id: string;
	clusterId: string;
	name: string;
	path: string;
	kind: FileKind;
	bytes: number;
	previewLine: string;
	/** True once a quill edit has been saved for this portal — WorldScene recomputes this whenever its save data changes, so the spyglass can offer a per-file "reset" action. */
	edited: boolean;
}

/** The portal the player is standing at in the world, as the expanded preview dock (react/PortalPreviewDock.tsx) needs it — WorldScene sets this on approach and clears it on leaving, so the dock (and any live url embed inside it) mounts and unmounts with it. */
export interface FocusedPortalPreview {
	portalId: string;
	fileName: string;
	path: string;
	/** Already resolved via systems/archPreview.ts's effectiveRichPreview — the same preview the arch itself paints, legacy fallback and quill edits included. */
	preview: DisplayPreview;
	/** The manifest's own list, re-checked by embedGuard at render time. */
	allowedEmbedOrigins: readonly string[];
}

/**
 * The one url-preview arch close enough (PORTAL_APPROACH_RADIUS) to carry a
 * live mini-page over its opening (react/PortalLivePage.tsx). Wider than
 * focusedPortalPreview's radius, so the page is already live by the time the
 * dock opens — which is why the dock shows a title card for url previews
 * instead of a second iframe of the same page. Its per-frame screen rect
 * rides the bus ("portal:web-rect"), not the store: it changes every frame
 * the camera moves and nothing needs to query it later.
 */
export interface NearWebPortal {
	portalId: string;
	url: string;
	title?: string;
	fallbackImage?: string;
	allowedEmbedOrigins: readonly string[];
}

export interface CabnState {
	worldMap: WorldMapSummary | null;
	mapOpen: boolean;
	visitedClusterIds: string[];
	mode: CabnMode;
	activeClusterId: string | null;
	activePortalId: string | null;
	/**
	 * Full text of the portal's file, captured at the moment of entry so the
	 * file overlay never has to re-fetch or reach back into scene-local chunk
	 * caches. Not in the original M3 field list — added because the overlay
	 * needs *something* to render and re-deriving it from loadedChunks would
	 * leak WorldScene's internal chunk cache shape into the store.
	 */
	activePortalContent: string | null;
	/** The open text file's edit buffer (see systems/fileBuffer.ts) — null for binary/media files, which aren't editable, and outside file mode. `activePortalContent` stays the last *saved* text; this is what's on screen. */
	activeFileState: EditorState | null;
	/** The buffer's doc as of the last save (or entry) — dirty is `!activeFileState.doc.eq(this)`. */
	activeFileSavedDoc: Text | null;
	/** True while the "unsaved changes" prompt for leaving the file view is up. */
	fileLeavePrompt: boolean;
	/** The open portal's resolved preview (same one its arch shows) — lets the file view render media/tables without reaching back into WorldScene. Null outside file mode, or when the caller didn't supply one. */
	activePortalPreview: DisplayPreview | null;
	loadedChunks: string[];
	playerPos: Position;
	searchOpen: boolean;
	/** True while the spyglass ("ls") panel is showing the active cluster's portals. */
	spyglassOpen: boolean;
	/**
	 * True while the satchel's full contents are shown as a literal open-bag
	 * panel (BagTray) — a React-only UI toggle, unlike spyglassOpen/searchOpen:
	 * grabbing a new slot (the "B" hotkey/tool:bag-use, FileScene-owned
	 * selection mechanic) never sets this, it only ever appends to bagSlots.
	 * This just controls whether the small closed-satchel badge or the big
	 * open-satchel view is what's currently rendered.
	 */
	bagOpen: boolean;
	/** Base URL (dir) of the currently-loaded world's manifest — the orb needs it to fetch that world's search-index.json lazily. */
	activeWorldBase: string | null;
	portals: PortalSummary[];
	bagSlots: BagSlot[];
	/** Line to place the caret on when the editor overlay mounts — only meaningful while `mode === "editor"`. */
	editorInitialLine: number;
	/** PortalFile.language of the file being edited, if any — picks the editor's lazily-loaded CodeMirror language pack. */
	editorLanguage: string | undefined;
	monsters: MonsterSummary[];
	/** Monster ids the player has defeated this save — WorldScene recomputes this whenever its save data changes, same pattern as PortalSummary.edited. */
	defeatedMonsterIds: string[];
	/** Which monster the current encounter banner/quill session is about — only meaningful while `mode === "encounter"` or an editor session that started from one. */
	activeMonsterId: string | null;
	/** Non-null only while `mode === "run"` — the parchment overlay's entire view of an in-progress run. */
	run: RunOverlayState | null;
	/** The player's choice (SettingsCorner) — "auto" derives from the local clock (see systems/timeOfDay.ts), "day"/"night" pin it. game.ts seeds this from timeOfDaySettings.ts (persisted choice, else "auto") before any scene reads it. */
	timeOfDayOverride: TimeOfDayOverride;
	/** Resolved from timeOfDayOverride (+ the clock, if "auto") — what every glow-bearing scene actually reads to pick its GlowParams preset and, at night, switch on fireflies. Recomputed whenever the override changes or (for "auto") periodically, by game.ts. */
	timeOfDay: TimeOfDay;
	focusedPortalPreview: FocusedPortalPreview | null;
	nearWebPortal: NearWebPortal | null;
	/** The guide NPC in the current world (render/guideNpc.ts publishes it on spawn and clears it on shutdown); null in every world without one. */
	guideNpc: GuideNpcSummary | null;
	/** True while the guide's dialogue box (react/GuideDialog.tsx) is open — WorldScene holds the player still meanwhile. */
	guideOpen: boolean;
	/** Every sign in the current world — signs.json at load, plus the owner's saves since. render/signposts.ts draws exactly this list. */
	signs: SignEntry[];
	/** The sign the player is standing at (small popup, react/SignPopup.tsx). */
	focusedSignPath: string | null;
	/** The sign open in the full reader (react/SignReader.tsx); the player holds still meanwhile. */
	openSignPath: string | null;
	/** Set only by a host page that passes CabnGame's `ownerSigns` (a local `cabn serve`); null in hosted builds and the demo, which then show no sign item and no edit controls. */
	ownerSigns: OwnerSignsApi | null;
	/** The owner picked the sign item and is choosing where the new sign stands. */
	signPlacing: boolean;
	/** The owner's sign editor (react/SignEditor.tsx), open while non-null. */
	signDraft: SignDraft | null;
	/** Folder path -> its (non-annex) cluster id, for resolving sign links to folders; render/signposts.ts fills it per world. */
	folderClusters: Record<string, string>;
}

export interface SignDraft {
	/** The sign being edited; null for a new one (the editor then asks for a file name). */
	path: string | null;
	near: { kind: "file" | "folder"; path: string };
	offset: Position | null;
	body: string;
	/** Default file name offered for a new sign. */
	suggestedPath: string;
}

export interface GuideNpcSummary {
	pos: Position;
	/** Whether the player has talked to the guide in this world's save — drives the "!" bubble. */
	talked: boolean;
}

export interface CabnActions {
	setWorldMap(worldMap: WorldMapSummary | null): void;
	setMapOpen(open: boolean): void;
	setVisitedClusterIds(ids: string[]): void;
	/** Clears world HUD/search metadata on shelf entry without discarding the bag or file buffer. */
	clearWorldContext(): void;
	setActiveCluster(clusterId: string | null): void;
	enterPortal(
		portalId: string,
		content: string | null,
		preview?: DisplayPreview,
	): void;
	exitPortal(): void;
	setLoadedChunks(clusterIds: string[]): void;
	setPlayerPos(pos: Position): void;
	setSearchOpen(open: boolean): void;
	setSpyglassOpen(open: boolean): void;
	setBagOpen(open: boolean): void;
	setActiveWorldBase(base: string | null): void;
	setPortals(portals: PortalSummary[]): void;
	addBagSlot(slot: BagSlot): void;
	removeBagSlot(id: string): void;
	/** The open file's saved content changed (a save, or a reset to pristine) — does not change `mode` or `activePortalId`. Marks the buffer saved; if the buffer's text differs (a reset) it's replaced by an undoable transaction. */
	setActivePortalContent(content: string): void;
	/** Every edit or caret move, from either the file view or the spellbook. */
	setActiveFileState(state: EditorState): void;
	setFileLeavePrompt(open: boolean): void;
	/** `initialLine` (an encounter) moves the shared caret to that line first; omitted (the quill), the spellbook opens wherever the file view's caret is. */
	openEditor(params: {
		initialLine?: number;
		language: string | undefined;
	}): void;
	/** Back to `mode: "file"` — the editor only ever opens on top of an already-open file, never standalone. */
	closeEditor(): void;
	setMonsters(monsters: MonsterSummary[]): void;
	setDefeatedMonsterIds(ids: string[]): void;
	/** Walking into a monster + E — shows the encounter banner (mode: "encounter"); FileScene opens the quill on top of it after a beat, same as any other openEditor() call. */
	startEncounter(monsterId: string): void;
	/** Back to `mode: "file"` with no active monster — either the player cancelled the banner (Esc) or a battle just resolved (win or shrug) and its animation finished. */
	endEncounter(): void;
	/** The wand tool starting a run — sets `mode: "run"` and the overlay's initial snapshot in one go. */
	startRun(run: RunOverlayState): void;
	/** FileScene's per-tick republish while a run is in progress — never touches `mode`. */
	setRun(run: RunOverlayState): void;
	/** Esc, or a run reaching "done" and the player closing the parchment — back to `mode: "file"`. */
	stopRun(): void;
	/** Sets the override and immediately re-resolves timeOfDay from it — the one action SettingsCorner's day/night control calls. */
	setTimeOfDayOverride(override: TimeOfDayOverride): void;
	/** Re-resolves timeOfDay from the *current* override — a no-op for "day"/"night" (already pinned), but "auto" needs this called periodically so a session left open across a day/night boundary actually crosses it (game.ts polls this on an interval). */
	refreshTimeOfDay(): void;
	setFocusedPortalPreview(preview: FocusedPortalPreview | null): void;
	setNearWebPortal(portal: NearWebPortal | null): void;
	setGuideNpc(guide: GuideNpcSummary | null): void;
	setGuideOpen(open: boolean): void;
	/** A world's signs and its folder -> cluster map, together, at world start. */
	setSigns(signs: SignEntry[], folderClusters?: Record<string, string>): void;
	/** Adds or replaces (by path) one sign — the owner's save, applied live. */
	upsertSign(sign: SignEntry): void;
	removeSign(path: string): void;
	setFocusedSign(path: string | null): void;
	setOpenSign(path: string | null): void;
	setOwnerSigns(api: OwnerSignsApi | null): void;
	/** Ignored without the owner capability, or outside world mode. */
	setSignPlacing(placing: boolean): void;
	/** Ignored without the owner capability. Always ends placement. */
	setSignDraft(draft: SignDraft | null): void;
}

export type CabnStore = CabnState & CabnActions;

const initialState: CabnState = {
	worldMap: null,
	mapOpen: false,
	visitedClusterIds: [],
	mode: "world",
	activeClusterId: null,
	activePortalId: null,
	activePortalContent: null,
	activeFileState: null,
	activeFileSavedDoc: null,
	fileLeavePrompt: false,
	activePortalPreview: null,
	loadedChunks: [],
	playerPos: { x: 0, y: 0 },
	searchOpen: false,
	spyglassOpen: false,
	bagOpen: false,
	activeWorldBase: null,
	portals: [],
	bagSlots: [],
	editorInitialLine: 0,
	editorLanguage: undefined,
	monsters: [],
	defeatedMonsterIds: [],
	activeMonsterId: null,
	run: null,
	timeOfDayOverride: "auto",
	timeOfDay: "day",
	focusedPortalPreview: null,
	nearWebPortal: null,
	guideNpc: null,
	guideOpen: false,
	signs: [],
	focusedSignPath: null,
	openSignPath: null,
	ownerSigns: null,
	signPlacing: false,
	signDraft: null,
	folderClusters: {},
};

export function createCabnStore(): StoreApi<CabnStore> {
	return createStore<CabnStore>((set, get) => ({
		...initialState,
		setWorldMap: (worldMap) =>
			set({ worldMap, mapOpen: false, visitedClusterIds: [] }),
		setMapOpen: (mapOpen) =>
			set({
				mapOpen:
					mapOpen &&
					get().worldMap !== null &&
					get().mode === "world" &&
					!get().guideOpen &&
					get().openSignPath === null &&
					get().signDraft === null,
			}),
		setVisitedClusterIds: (visitedClusterIds) => set({ visitedClusterIds }),
		clearWorldContext: () =>
			set({
				worldMap: null,
				mapOpen: false,
				visitedClusterIds: [],
				activeClusterId: null,
				activeWorldBase: null,
				loadedChunks: [],
				portals: [],
				monsters: [],
				defeatedMonsterIds: [],
				searchOpen: false,
				spyglassOpen: false,
				focusedPortalPreview: null,
				nearWebPortal: null,
				guideNpc: null,
				guideOpen: false,
				signs: [],
				focusedSignPath: null,
				openSignPath: null,
				signPlacing: false,
				signDraft: null,
				folderClusters: {},
			}),
		setActiveCluster: (activeClusterId) => set({ activeClusterId }),
		enterPortal: (portalId, content, preview) => {
			const buffer = content === null ? null : createFileBufferState(content);
			set({
				mode: "file",
				mapOpen: false,
				activePortalId: portalId,
				activePortalContent: content,
				activeFileState: buffer,
				activeFileSavedDoc: buffer?.doc ?? null,
				fileLeavePrompt: false,
				activePortalPreview: preview ?? null,
			});
		},
		exitPortal: () =>
			set({
				mode: "world",
				activePortalId: null,
				activePortalContent: null,
				activeFileState: null,
				activeFileSavedDoc: null,
				fileLeavePrompt: false,
				activePortalPreview: null,
			}),
		setLoadedChunks: (loadedChunks) => set({ loadedChunks }),
		setPlayerPos: (playerPos) => set({ playerPos }),
		setSearchOpen: (searchOpen) => set({ searchOpen }),
		setSpyglassOpen: (spyglassOpen) => set({ spyglassOpen }),
		setBagOpen: (bagOpen) => set({ bagOpen }),
		setActiveWorldBase: (activeWorldBase) => set({ activeWorldBase }),
		setPortals: (portals) => set({ portals }),
		addBagSlot: (slot) => set({ bagSlots: addBagSlot(get().bagSlots, slot) }),
		removeBagSlot: (id) => set({ bagSlots: removeBagSlot(get().bagSlots, id) }),
		setActivePortalContent: (activePortalContent) => {
			const buffer = get().activeFileState;
			if (!buffer) {
				set({ activePortalContent });
				return;
			}
			if (buffer.doc.toString() === activePortalContent) {
				set({ activePortalContent, activeFileSavedDoc: buffer.doc });
				return;
			}
			const head = Math.min(
				buffer.selection.main.head,
				activePortalContent.length,
			);
			const next = buffer.update({
				changes: {
					from: 0,
					to: buffer.doc.length,
					insert: activePortalContent,
				},
				selection: { anchor: head },
				// Its own undo step, never merged into typing just before it.
				annotations: isolateHistory.of("full"),
			}).state;
			set({
				activePortalContent,
				activeFileState: next,
				activeFileSavedDoc: next.doc,
			});
		},
		setActiveFileState: (activeFileState) => set({ activeFileState }),
		setFileLeavePrompt: (fileLeavePrompt) => set({ fileLeavePrompt }),
		openEditor: ({ initialLine, language }) => {
			const buffer = get().activeFileState;
			let activeFileState = buffer;
			if (buffer && initialLine !== undefined) {
				const lineNumber = Math.min(
					Math.max(initialLine + 1, 1),
					buffer.doc.lines,
				);
				activeFileState = buffer.update({
					selection: EditorSelection.cursor(buffer.doc.line(lineNumber).from),
				}).state;
			}
			set({
				mode: "editor",
				editorInitialLine:
					initialLine ??
					(buffer
						? buffer.doc.lineAt(buffer.selection.main.head).number - 1
						: 0),
				editorLanguage: language,
				activeFileState,
			});
		},
		closeEditor: () => set({ mode: "file" }),
		setMonsters: (monsters) => set({ monsters }),
		setDefeatedMonsterIds: (defeatedMonsterIds) => set({ defeatedMonsterIds }),
		startEncounter: (monsterId) =>
			set({ mode: "encounter", activeMonsterId: monsterId }),
		endEncounter: () => set({ mode: "file", activeMonsterId: null }),
		startRun: (run) => set({ mode: "run", run }),
		setRun: (run) => set({ run }),
		stopRun: () => set({ mode: "file", run: null }),
		setTimeOfDayOverride: (timeOfDayOverride) =>
			set({
				timeOfDayOverride,
				timeOfDay: resolveTimeOfDay(timeOfDayOverride),
			}),
		refreshTimeOfDay: () =>
			set((state) => ({
				timeOfDay: resolveTimeOfDay(state.timeOfDayOverride),
			})),
		setFocusedPortalPreview: (focusedPortalPreview) =>
			set({ focusedPortalPreview }),
		setNearWebPortal: (nearWebPortal) => set({ nearWebPortal }),
		setGuideNpc: (guideNpc) => set({ guideNpc }),
		setGuideOpen: (guideOpen) => set({ guideOpen }),
		setSigns: (signs, folderClusters) =>
			set(folderClusters ? { signs, folderClusters } : { signs }),
		upsertSign: (sign) =>
			set((state) => ({
				signs: [...state.signs.filter((s) => s.path !== sign.path), sign],
			})),
		removeSign: (path) =>
			set((state) => ({
				signs: state.signs.filter((s) => s.path !== path),
				focusedSignPath:
					state.focusedSignPath === path ? null : state.focusedSignPath,
				openSignPath: state.openSignPath === path ? null : state.openSignPath,
			})),
		setFocusedSign: (focusedSignPath) => set({ focusedSignPath }),
		setOpenSign: (openSignPath) => set({ openSignPath }),
		setOwnerSigns: (ownerSigns) =>
			set(
				ownerSigns
					? { ownerSigns }
					: { ownerSigns, signPlacing: false, signDraft: null },
			),
		setSignPlacing: (signPlacing) =>
			set({
				signPlacing:
					signPlacing && get().ownerSigns !== null && get().mode === "world",
			}),
		setSignDraft: (signDraft) =>
			set({
				signDraft: get().ownerSigns !== null ? signDraft : null,
				signPlacing: false,
			}),
	}));
}
