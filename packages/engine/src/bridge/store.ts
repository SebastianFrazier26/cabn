import type { FileKind, Position, Species } from "@cabn/world-schema";
import { createStore, type StoreApi } from "zustand/vanilla";
import { addBagSlot, type BagSlot, removeBagSlot } from "../systems/bag.js";
import type { RunSpeed, RunStatus } from "../systems/runPlayback.js";
import {
	resolveTimeOfDay,
	type TimeOfDay,
	type TimeOfDayOverride,
} from "../systems/timeOfDay.js";

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

export interface CabnState {
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
	loadedChunks: string[];
	playerPos: Position;
	searchOpen: boolean;
	/** True while the spyglass ("ls") panel is showing the active cluster's portals. */
	spyglassOpen: boolean;
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
	/** The glow post-fx toggle (SettingsCorner) — a store field, not scene-local, because every scene's camera needs to react to it and the setting must survive a scene swap (world -> file -> world). game.ts seeds this from glowSettings.ts (persisted choice, else prefers-reduced-motion) before any scene reads it. */
	glowEnabled: boolean;
	/** Non-null only while `mode === "run"` — the parchment overlay's entire view of an in-progress run. */
	run: RunOverlayState | null;
	/** The player's choice (SettingsCorner) — "auto" derives from the local clock (see systems/timeOfDay.ts), "day"/"night" pin it. game.ts seeds this from timeOfDaySettings.ts (persisted choice, else "auto") before any scene reads it. */
	timeOfDayOverride: TimeOfDayOverride;
	/** Resolved from timeOfDayOverride (+ the clock, if "auto") — what every glow-bearing scene actually reads to pick its GlowParams preset and, at night, switch on fireflies. Recomputed whenever the override changes or (for "auto") periodically, by game.ts. */
	timeOfDay: TimeOfDay;
}

export interface CabnActions {
	setActiveCluster(clusterId: string | null): void;
	enterPortal(portalId: string, content: string | null): void;
	exitPortal(): void;
	setLoadedChunks(clusterIds: string[]): void;
	setPlayerPos(pos: Position): void;
	setSearchOpen(open: boolean): void;
	setSpyglassOpen(open: boolean): void;
	setActiveWorldBase(base: string | null): void;
	setPortals(portals: PortalSummary[]): void;
	addBagSlot(slot: BagSlot): void;
	removeBagSlot(id: string): void;
	/** Replaces the open file's content in place, e.g. after a quill save — does not change `mode` or `activePortalId`. */
	setActivePortalContent(content: string): void;
	openEditor(params: {
		initialLine: number;
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
	setGlowEnabled(enabled: boolean): void;
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
}

export type CabnStore = CabnState & CabnActions;

const initialState: CabnState = {
	mode: "world",
	activeClusterId: null,
	activePortalId: null,
	activePortalContent: null,
	loadedChunks: [],
	playerPos: { x: 0, y: 0 },
	searchOpen: false,
	spyglassOpen: false,
	activeWorldBase: null,
	portals: [],
	bagSlots: [],
	editorInitialLine: 0,
	editorLanguage: undefined,
	monsters: [],
	defeatedMonsterIds: [],
	activeMonsterId: null,
	glowEnabled: true,
	run: null,
	timeOfDayOverride: "auto",
	timeOfDay: "day",
};

export function createCabnStore(): StoreApi<CabnStore> {
	return createStore<CabnStore>((set, get) => ({
		...initialState,
		setActiveCluster: (activeClusterId) => set({ activeClusterId }),
		enterPortal: (portalId, content) =>
			set({
				mode: "file",
				activePortalId: portalId,
				activePortalContent: content,
			}),
		exitPortal: () =>
			set({ mode: "world", activePortalId: null, activePortalContent: null }),
		setLoadedChunks: (loadedChunks) => set({ loadedChunks }),
		setPlayerPos: (playerPos) => set({ playerPos }),
		setSearchOpen: (searchOpen) => set({ searchOpen }),
		setSpyglassOpen: (spyglassOpen) => set({ spyglassOpen }),
		setActiveWorldBase: (activeWorldBase) => set({ activeWorldBase }),
		setPortals: (portals) => set({ portals }),
		addBagSlot: (slot) => set({ bagSlots: addBagSlot(get().bagSlots, slot) }),
		removeBagSlot: (id) => set({ bagSlots: removeBagSlot(get().bagSlots, id) }),
		setActivePortalContent: (activePortalContent) =>
			set({ activePortalContent }),
		openEditor: ({ initialLine, language }) =>
			set({
				mode: "editor",
				editorInitialLine: initialLine,
				editorLanguage: language,
			}),
		closeEditor: () => set({ mode: "file" }),
		setMonsters: (monsters) => set({ monsters }),
		setDefeatedMonsterIds: (defeatedMonsterIds) => set({ defeatedMonsterIds }),
		startEncounter: (monsterId) =>
			set({ mode: "encounter", activeMonsterId: monsterId }),
		endEncounter: () => set({ mode: "file", activeMonsterId: null }),
		setGlowEnabled: (glowEnabled) => set({ glowEnabled }),
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
	}));
}
