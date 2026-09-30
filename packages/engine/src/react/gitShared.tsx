import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { useLoadingWhile } from "./useLoadingWhile.js";

const jsonCache = new Map<string, Promise<unknown | null>>();

/** history/commits/*.json and chunks are immutable per bundle, so each url is fetched once per page. */
export function fetchJsonOnce(url: string): Promise<unknown | null> {
	let pending = jsonCache.get(url);
	if (!pending) {
		pending = fetch(url)
			.then((res) => (res.ok ? res.json() : null))
			.catch(() => null);
		jsonCache.set(url, pending);
	}
	return pending;
}

/**
 * While a git panel is open it owns the keyboard: Escape closes it, and no
 * key reaches Phaser (capture phase, same as the guide's dialogue box).
 * Keys still act natively on the panel's own buttons and text fields,
 * because only propagation is stopped, not the default action.
 */
export function useModalKeys(open: boolean, onClose: () => void): void {
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			event.stopPropagation();
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open, onClose]);
}

/** What a git panel shows while its lazy chunk loads: the same dim backdrop, so the click visibly landed, and the loading panel if the chunk is slow. */
export function GitPanelFallback({
	seedKey,
	store,
	label,
}: {
	seedKey: string;
	store: StoreApi<CabnStore>;
	label: string;
}): React.ReactElement {
	useLoadingWhile(store, true, label);
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				zIndex: 13,
				pointerEvents: "auto",
				background: "#0009",
				display: "grid",
				placeItems: "center",
			}}
		>
			<span data-loading={seedKey} style={{ color: "#fff", fontSize: 12 }}>
				…
			</span>
		</div>
	);
}
