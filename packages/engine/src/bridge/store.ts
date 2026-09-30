import type {
	FileKind,
	GitMeta,
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
import type { PetProviderId } from "../pets/providers.js";
import type { PetProposal, PetWorldAccess } from "../pets/tools.js";
import type { PixelThemeTokens } from "../react/pixelThemeTokens.js";
import type { DisplayPreview } from "../systems/archPreview.js";
import { addBagSlot, type BagSlot, removeBagSlot } from "../systems/bag.js";
import { createFileBufferState } from "../systems/fileBuffer.js";
import type { OwnerSignsApi } from "../systems/ownerSigns.js";
import type { OwnerGitAction } from "../systems/ownerToolkit.js";
import type { RunSpeed, RunStatus } from "../systems/runPlayback.js";
import type { TimeOfDay, TimeOfDayOverride } from "../systems/timeOfDay.js";
import {
	resolveSkinTimeOfDay,
	type WorldLayerProvider,
} from "../systems/worldLayer.js";
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
	/** Set on a portal an active world layer added (systems/worldLayer.ts); absent for base portals. */
	layer?: true;
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
	/** Resolved from timeOfDayPin, else timeOfDayOverride (+ the clock, if "auto") — what every glow-bearing scene actually reads to pick its GlowParams preset and, at night, switch on fireflies. Recomputed whenever the override or pin changes or (for "auto") periodically, by game.ts. */
	timeOfDay: TimeOfDay;
	/** The shown world layer's fixed time of day (its skin's `fixedTimeOfDay`); while set, the override and the clock are ignored. */
	timeOfDayPin: TimeOfDay | null;
	focusedPortalPreview: FocusedPortalPreview | null;
	nearWebPortal: NearWebPortal | null;
	/** The guide NPC in the current world (render/guideNpc.ts publishes it on spawn and clears it on shutdown); null in every world without one. */
	guideNpc: GuideNpcSummary | null;
	/** True while the guide's dialogue box (react/GuideDialog.tsx) is open — WorldScene holds the player still meanwhile. */
	guideOpen: boolean;
	git: GitContext | null;
	/** True while the rift's universe picker is open — WorldScene holds the player still meanwhile. */
	universeOpen: boolean;
	/** The owner git flow the picker was opened for from the owner's toolkit (its Owner tab, that section); null otherwise. */
	universeOwnerFocus: OwnerGitAction | null;
	/** The owner's toolkit menu (react/OwnerToolkit.tsx); only ever true on an owner page, in world mode. */
	ownerToolkitOpen: boolean;
	/** The portal whose file history (the pensieve) is open, if any. */
	pensievePortalId: string | null;
	/** Where the rift stands (render/rift.ts publishes it) — the map draws it; null without one. */
	riftPos: Position | null;
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
	/** The provider whose pet follows the player (react/PetLayer.tsx picks it; keys never live in the store — see pets/keyStore.ts). */
	petProvider: PetProviderId | null;
	petPanelOpen: boolean;
	/** True while the pet's chat is open — WorldScene holds the player still, like the guide. */
	petChatOpen: boolean;
	/** The pet sprite in the current world (render/petCompanion.ts publishes it); null outside worlds. */
	petNpc: { pos: Position } | null;
	/** The current world's files as the pet may read them — WorldScene publishes it on create and clears it on shutdown. */
	petWorld: PetWorldAccess | null;
	petMessages: PetChatMessage[];
	petProposals: PetProposal[];
	/** World layers the host offers (CabnGame's `owner.layers`); empty in hosted builds and the demo. */
	worldLayers: WorldLayerProvider[];
	/** The layer the current world shows, if any. Never persisted: every reload starts without one. */
	activeLayerId: string | null;
	/** The active layer's HUD palette (react/pixelTheme.tsx), or null for the normal day/night one. */
	layerUiTokens: PixelThemeTokens | null;
	/** A layer file save that didn't land (react/LayerSaveNotice.tsx). */
	layerSaveIssue: LayerSaveIssue | null;
}

export interface LayerSaveIssue {
	portalId: string;
	message: string;
	/** The file changed where it lives since it was loaded: offer to reload it. */
	conflict: boolean;
}

/** The world's git history, as the rift, map timeline and pensieve read it (WorldScene sets it from the bundle's history.json; null for a world without one). */
export interface GitContext {
	/** git/meta.json of the main world's bundle (branch/tag summaries); the objects themselves load lazily (systems/git/). */
	meta: GitMeta;
	/** This world's meta.generatedAt — every universe converts with the main world's, so its save slot survives reloads. */
	generatedAt: string;
	/** Base url of the bundle history.json came from — the main world's, also while visiting a universe. */
	historyBase: string;
	/** The branch this world shows: the checked-out branch for the main world, the universe's branch otherwise. */
	branch: string;
	/** Set while visiting an alternate universe; null in the main world. */
	universe: { slug: string; branch: string } | null;
	/** This world's save slot (systems/save.ts computeWorldId). */
	worldId: string;
	/** The main world's meta.source, shared by every universe of it (the in-browser stash key). */
	rootSource: string;
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

export interface PetChatMessage {
	id: string;
	role: "player" | "pet";
	text: string;
	/** Files the pet read or proposed changes to for this answer. */
	cited?: string[];
	proposalIds?: string[];
	/** A link the in-character error message ends with (billing/key console). */
	link?: { href: string; label: string };
	error?: boolean;
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
	/** Clicking (or Alt+Enter beside) a monster — shows the encounter popup (mode: "encounter"). It no longer auto-advances on a timer (2026-09-29): the popup owns the keyboard until the player dismisses it (see react/EncounterBanner.tsx), and only a dismiss-to-continue opens the quill via `encounter:continue`, same as any other openEditor() call. */
	startEncounter(monsterId: string): void;
	/** Back to `mode: "file"` with no active monster — either the player cancelled the popup (Esc) or a battle just resolved (win or shrug) and its animation finished. */
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
	/** WorldScene, before it builds anything: the skin it is about to draw pins (or, null, releases) the time of day. */
	setTimeOfDayPin(pin: TimeOfDay | null): void;
	setFocusedPortalPreview(preview: FocusedPortalPreview | null): void;
	setNearWebPortal(portal: NearWebPortal | null): void;
	setGuideNpc(guide: GuideNpcSummary | null): void;
	setGuideOpen(open: boolean): void;
	setGit(git: GitContext | null): void;
	/** Opens only in world mode, with history loaded and nothing else modal. */
	setUniverseOpen(open: boolean): void;
	/** Opens the rift's picker on its Owner tab at one git flow; same conditions as setUniverseOpen. */
	openOwnerGit(action: OwnerGitAction): void;
	/** Opens only in world mode, with nothing else modal. */
	setOwnerToolkitOpen(open: boolean): void;
	setPensievePortalId(portalId: string | null): void;
	setRiftPos(pos: Position | null): void;
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
	setPetProvider(provider: PetProviderId | null): void;
	setPetPanelOpen(open: boolean): void;
	setPetChatOpen(open: boolean): void;
	setPetNpc(pet: { pos: Position } | null): void;
	setPetWorld(world: PetWorldAccess | null): void;
	addPetMessage(message: PetChatMessage): void;
	addPetProposals(proposals: PetProposal[]): void;
	setPetProposalStatus(id: string, status: PetProposal["status"]): void;
	/** New provider, new world or "forget": the conversation starts over. */
	clearPetConversation(): void;
	setWorldLayers(layers: WorldLayerProvider[]): void;
	/** WorldScene, once it has (re)started with or without a layer. An id no offered provider has clears it. */
	setActiveLayer(layerId: string | null): void;
	setLayerSaveIssue(issue: LayerSaveIssue | null): void;
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
	timeOfDayPin: null,
	focusedPortalPreview: null,
	nearWebPortal: null,
	guideNpc: null,
	guideOpen: false,
	git: null,
	universeOpen: false,
	universeOwnerFocus: null,
	ownerToolkitOpen: false,
	pensievePortalId: null,
	riftPos: null,
	signs: [],
	focusedSignPath: null,
	openSignPath: null,
	ownerSigns: null,
	signPlacing: false,
	signDraft: null,
	folderClusters: {},
	petProvider: null,
	petPanelOpen: false,
	petChatOpen: false,
	petNpc: null,
	petWorld: null,
	petMessages: [],
	petProposals: [],
	worldLayers: [],
	activeLayerId: null,
	layerUiTokens: null,
	layerSaveIssue: null,
};

function pinned(
	pin: TimeOfDay | null,
	override: TimeOfDayOverride,
): Pick<CabnState, "timeOfDayPin" | "timeOfDay"> {
	return {
		timeOfDayPin: pin,
		timeOfDay: resolveSkinTimeOfDay({ fixedTimeOfDay: pin }, override),
	};
}

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
				git: null,
				universeOpen: false,
				universeOwnerFocus: null,
				ownerToolkitOpen: false,
				pensievePortalId: null,
				riftPos: null,
				signs: [],
				focusedSignPath: null,
				openSignPath: null,
				signPlacing: false,
				signDraft: null,
				folderClusters: {},
				petChatOpen: false,
				petNpc: null,
				petWorld: null,
				petMessages: [],
				petProposals: [],
				activeLayerId: null,
				layerUiTokens: null,
				layerSaveIssue: null,
				...pinned(null, get().timeOfDayOverride),
			}),
		setActiveCluster: (activeClusterId) => set({ activeClusterId }),
		enterPortal: (portalId, content, preview) => {
			const buffer = content === null ? null : createFileBufferState(content);
			set({
				mode: "file",
				mapOpen: false,
				ownerToolkitOpen: false,
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
			set((state) => ({
				timeOfDayOverride,
				...pinned(state.timeOfDayPin, timeOfDayOverride),
			})),
		refreshTimeOfDay: () =>
			set((state) => pinned(state.timeOfDayPin, state.timeOfDayOverride)),
		setTimeOfDayPin: (pin) =>
			set((state) => pinned(pin, state.timeOfDayOverride)),
		setFocusedPortalPreview: (focusedPortalPreview) =>
			set({ focusedPortalPreview }),
		setNearWebPortal: (nearWebPortal) => set({ nearWebPortal }),
		setGuideNpc: (guideNpc) => set({ guideNpc }),
		setGuideOpen: (guideOpen) => set({ guideOpen }),
		setGit: (git) =>
			set({
				git,
				universeOpen: false,
				universeOwnerFocus: null,
				pensievePortalId: null,
			}),
		setUniverseOpen: (open) => {
			const s = get();
			set({
				universeOpen:
					open &&
					s.git !== null &&
					s.mode === "world" &&
					!s.guideOpen &&
					!s.mapOpen,
				universeOwnerFocus: null,
			});
		},
		openOwnerGit: (action) => {
			get().setUniverseOpen(true);
			if (get().universeOpen) set({ universeOwnerFocus: action });
		},
		setOwnerToolkitOpen: (open) => {
			const s = get();
			set({
				ownerToolkitOpen:
					open &&
					s.mode === "world" &&
					!s.guideOpen &&
					!s.mapOpen &&
					!s.universeOpen &&
					s.pensievePortalId === null &&
					s.openSignPath === null &&
					s.signDraft === null,
			});
		},
		setPensievePortalId: (pensievePortalId) => set({ pensievePortalId }),
		setRiftPos: (riftPos) => set({ riftPos }),
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
		setPetProvider: (petProvider) => set({ petProvider }),
		setPetPanelOpen: (petPanelOpen) => set({ petPanelOpen }),
		setPetChatOpen: (petChatOpen) =>
			set({ petChatOpen, mapOpen: petChatOpen ? false : get().mapOpen }),
		setPetNpc: (petNpc) => set({ petNpc }),
		setPetWorld: (petWorld) => set({ petWorld }),
		addPetMessage: (message) =>
			set({ petMessages: [...get().petMessages, message] }),
		addPetProposals: (proposals) =>
			set({ petProposals: [...get().petProposals, ...proposals] }),
		setPetProposalStatus: (id, status) =>
			set({
				petProposals: get().petProposals.map((p) =>
					p.id === id ? { ...p, status } : p,
				),
			}),
		clearPetConversation: () => set({ petMessages: [], petProposals: [] }),
		setWorldLayers: (worldLayers) => {
			const active = get().activeLayerId;
			const keep = active !== null && worldLayers.some((l) => l.id === active);
			const override = get().timeOfDayOverride;
			set(
				keep || active === null
					? { worldLayers }
					: {
							worldLayers,
							activeLayerId: null,
							layerUiTokens: null,
							...pinned(null, override),
						},
			);
		},
		setActiveLayer: (layerId) => {
			const provider =
				layerId === null
					? undefined
					: get().worldLayers.find((l) => l.id === layerId);
			const override = get().timeOfDayOverride;
			set(
				provider
					? {
							activeLayerId: provider.id,
							layerUiTokens: provider.skin.uiTokens,
							...pinned(provider.skin.fixedTimeOfDay, override),
						}
					: {
							activeLayerId: null,
							layerUiTokens: null,
							layerSaveIssue: null,
							...pinned(null, override),
						},
			);
		},
		setLayerSaveIssue: (layerSaveIssue) => set({ layerSaveIssue }),
	}));
}
