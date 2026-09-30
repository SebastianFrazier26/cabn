import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";

/** Holds a loading token for as long as `active` is true (and the component is mounted), for loads React already tracks as state. Without a store it does nothing, for components that also render outside a game. */
export function useLoadingWhile(
	store: StoreApi<CabnStore> | undefined,
	active: boolean,
	label: string,
	detail?: string,
): void {
	useEffect(() => {
		if (!active || !store) return;
		const token = store
			.getState()
			.beginLoading(label, detail ? { detail } : undefined);
		return () => store.getState().endLoading(token);
	}, [store, active, label, detail]);
}
