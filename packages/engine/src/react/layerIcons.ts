import { type SyntheticEvent, useCallback } from "react";
import type { StoreApi } from "zustand/vanilla";
import { assetUrl } from "../assetPaths.js";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

/** Maps a HUD icon's canonical URL to the active layer skin's replacement (WorldSkin.uiIcons), or to where the host serves it (assetUrl). */
export function useLayerIcon(
	store: StoreApi<CabnStore>,
): (src: string) => string {
	const icons = useCabnStore(
		store,
		(s) =>
			s.worldLayers.find((l) => l.id === s.activeLayerId)?.skin.uiIcons ?? null,
	);
	return useCallback((src: string) => icons?.[src] ?? assetUrl(src), [icons]);
}

/** onError for a skinned icon: a replacement that fails to load (a layer's art is owner-served) falls back to the normal one. */
export function iconFallback(
	normal: string,
): (event: SyntheticEvent<HTMLImageElement>) => void {
	return (event) => {
		const img = event.currentTarget;
		const url = assetUrl(normal);
		if (img.getAttribute("src") !== url) img.src = url;
	};
}
