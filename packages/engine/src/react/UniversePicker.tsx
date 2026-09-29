import { lazy, Suspense, useCallback } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import type { OwnerCapability } from "../systems/ownerApi.js";
import { GitPanelFallback, useModalKeys } from "./gitShared.js";
import { useCabnStore } from "./useCabnStore.js";

// Lazy, like the git reader: a plain page load carries only this wrapper.
const Dialog = lazy(() =>
	import("./UniversePickerPanel.js").then((m) => ({
		default: m.UniversePickerDialog,
	})),
);

/** The rift's dialog: travel between branch universes, read tags and GitHub releases, and (owner mode only) commit and switch for real. */
export function UniversePicker({
	store,
	bus,
	owner,
}: {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	owner?: OwnerCapability;
}): React.ReactElement | null {
	const open = useCabnStore(store, (s) => s.universeOpen);
	const git = useCabnStore(store, (s) => s.git);
	const mode = useCabnStore(store, (s) => s.mode);
	const close = useCallback(
		() => store.getState().setUniverseOpen(false),
		[store],
	);
	useModalKeys(open, close);
	if (!open || !git || mode !== "world") return null;
	return (
		<Suspense fallback={<GitPanelFallback seedKey="rift" />}>
			<Dialog store={store} bus={bus} owner={owner} git={git} close={close} />
		</Suspense>
	);
}
