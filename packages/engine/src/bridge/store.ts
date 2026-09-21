import type { Position } from "@cabn/world-schema";
import { createStore, type StoreApi } from "zustand/vanilla";

export type CabnMode = "world" | "file";

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
}

export interface CabnActions {
	setActiveCluster(clusterId: string | null): void;
	enterPortal(portalId: string, content: string | null): void;
	exitPortal(): void;
	setLoadedChunks(clusterIds: string[]): void;
	setPlayerPos(pos: Position): void;
	setSearchOpen(open: boolean): void;
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
};

export function createCabnStore(): StoreApi<CabnStore> {
	return createStore<CabnStore>((set) => ({
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
	}));
}
