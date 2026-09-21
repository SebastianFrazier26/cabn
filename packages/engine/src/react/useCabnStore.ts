import { useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";

/**
 * Bridges the vanilla zustand store into React without pulling in zustand's
 * own React bindings package — useSyncExternalStore already does exactly
 * what that package wraps, and the store is otherwise dependency-free.
 */
export function useCabnStore<T>(
	store: StoreApi<CabnStore>,
	selector: (state: CabnStore) => T,
): T {
	return useSyncExternalStore(
		store.subscribe,
		() => selector(store.getState()),
		() => selector(store.getState()),
	);
}
