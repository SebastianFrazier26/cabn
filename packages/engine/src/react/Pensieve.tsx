import { lazy, Suspense, useCallback, useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { activeFocusOwner } from "../systems/uiFocus.js";
import { GitPanelFallback, useModalKeys } from "./gitShared.js";
import { useCabnStore } from "./useCabnStore.js";

const Panel = lazy(() =>
	import("./PensievePanel.js").then((m) => ({ default: m.PensievePanel })),
);

interface Props {
	store: StoreApi<CabnStore>;
}

/**
 * The pensieve: one file's memories, read from the world's real git
 * objects. A timeline of the commits (on this universe's branch) that
 * touched it, each change as a diff computed in the browser, and the whole
 * file exactly as it was after any of them.
 *
 * Opened with H at an arch (world) or Alt/Option+H inside a file.
 */
export function Pensieve({ store }: Props): React.ReactElement | null {
	const portalId = useCabnStore(store, (s) => s.pensievePortalId);
	const git = useCabnStore(store, (s) => s.git);
	const close = useCallback(
		() => store.getState().setPensievePortalId(null),
		[store],
	);
	useModalKeys(portalId !== null, close);
	usePensieveHotkeys(store);
	if (!portalId || !git) return null;
	return (
		<Suspense fallback={<GitPanelFallback seedKey={portalId} />}>
			<Panel
				key={`${git.worldId}:${portalId}`}
				git={git}
				path={portalId}
				onClose={close}
			/>
		</Suspense>
	);
}

function usePensieveHotkeys(store: StoreApi<CabnStore>): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.code !== "KeyH" ||
				event.metaKey ||
				event.ctrlKey ||
				event.repeat
			)
				return;
			const s = store.getState();
			if (!s.git || s.pensievePortalId !== null) return;
			let target: string | null = null;
			// Inside a file letters type, so it's the Alt chord there (by physical key, like the other file-view tools).
			if (s.mode === "file" && event.altKey) target = s.activePortalId;
			else if (
				s.mode === "world" &&
				!event.altKey &&
				!s.mapOpen &&
				!s.guideOpen &&
				!s.universeOpen &&
				activeFocusOwner() !== "text"
			)
				target = s.focusedPortalPreview?.portalId ?? null;
			if (!target) return;
			event.preventDefault();
			event.stopPropagation();
			s.setPensievePortalId(target);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
}
