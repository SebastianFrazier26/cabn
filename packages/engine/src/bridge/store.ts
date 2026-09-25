import type { FileKind, Position } from "@cabn/world-schema";
import { createStore, type StoreApi } from "zustand/vanilla";
import { addBagSlot, type BagSlot, removeBagSlot } from "../systems/bag.js";

export type CabnMode = "world" | "file";

/** Flat, per-portal summary WorldScene fills once at create() — backs both the spyglass panel and the orb's world-search result list, so neither needs its own copy of the manifest. */
export interface PortalSummary {
	id: string;
	clusterId: string;
	name: string;
	path: string;
	kind: FileKind;
	bytes: number;
	previewLine: string;
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
	}));
}
