import { type SyntheticEvent, useCallback } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

/** Maps a HUD icon's normal URL to the active layer skin's replacement (WorldSkin.uiIcons), or back to itself. */
export function useLayerIcon(
	store: StoreApi<CabnStore>,
): (src: string) => string {
	const icons = useCabnStore(
		store,
		(s) =>
			s.worldLayers.find((l) => l.id === s.activeLayerId)?.skin.uiIcons ?? null,
	);
	return useCallback((src: string) => icons?.[src] ?? src, [icons]);
}

/** onError for a skinned icon: a replacement that fails to load (a layer's art is owner-served) falls back to the normal one. */
export function iconFallback(
	normal: string,
): (event: SyntheticEvent<HTMLImageElement>) => void {
	return (event) => {
		const img = event.currentTarget;
		if (img.getAttribute("src") !== normal) img.src = normal;
	};
}
