import { useEffect, useRef, useState } from "react";
import {
	type CabnGameHandle,
	type CabnGameTarget,
	createCabnGame,
} from "../game.js";
import { configureMedia } from "../render/mediaSources.js";
import { BagTray } from "./BagTray.js";
import { EditorOverlay } from "./EditorOverlay.js";
import { EncounterBanner } from "./EncounterBanner.js";
import { FileOverlay } from "./FileOverlay.js";
import { FileStatusLine } from "./FileStatusLine.js";
import { GuideDialog } from "./GuideDialog.js";
import { MonsterCounter } from "./MonsterCounter.js";
import { OrbSearch } from "./OrbSearch.js";
import { PortalLivePage } from "./PortalLivePage.js";
import { PortalPreviewDock } from "./PortalPreviewDock.js";
import { PixelTheme } from "./pixelTheme.js";
import { RunOverlay } from "./RunOverlay.js";
import { SceneTransitionOverlay } from "./SceneTransitionOverlay.js";
import { SettingsCorner } from "./SettingsCorner.js";
import { SpyglassPanel } from "./SpyglassPanel.js";
import { ToolHotbar } from "./ToolHotbar.js";
import { VictoryToast } from "./VictoryToast.js";
import { WorldMap } from "./WorldMap.js";

// Exactly one of the two: a plain worldUrl boots straight into that world (no
// shelf to return to); shelfUrl boots into the shelf hub, which then boots
// worlds itself as the player walks into cabins (see ShelfScene).
export type CabnGameProps = ({ worldUrl: string } | { shelfUrl: string }) & {
	/**
	 * Fires once per mount with the freshly-created game/store/bus, and again
	 * with null on unmount. Optional — added for host apps that need their own
	 * hooks into the store (e.g. a browser e2e test asserting on game state);
	 * CabnGame itself never calls this for anything internal.
	 */
	onGameReady?: (handle: CabnGameHandle | null) => void;
	/**
	 * Where the host serves pdf.js's worker (pdfjs-dist/build/pdf.worker.min.mjs,
	 * same exact version as the engine's). Required for PDF previews — cabn
	 * never fetches it from a CDN; without it PDFs show a "viewer unavailable"
	 * notice. A Vite host can pass `import url from "pdfjs-dist/build/pdf.worker.min.mjs?url"`.
	 */
	pdfWorkerUrl?: string;
};

export function CabnGame(props: CabnGameProps): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	// State, not a ref: FileOverlay needs a re-render once the game (and its
	// store) exists, and mutating a ref alone never schedules one.
	const [handle, setHandle] = useState<CabnGameHandle | null>(null);
	// Destructured to stable primitives, not the `props` object itself, so the
	// effect below re-creates the game exactly when the target url changes —
	// not on every render (props is a fresh object every time).
	const worldUrl = "worldUrl" in props ? props.worldUrl : undefined;
	const shelfUrl = "shelfUrl" in props ? props.shelfUrl : undefined;
	const { onGameReady, pdfWorkerUrl } = props;

	useEffect(() => {
		if (pdfWorkerUrl !== undefined) configureMedia({ pdfWorkerUrl });
	}, [pdfWorkerUrl]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: onGameReady is deliberately excluded — an inline arrow-function prop (the common case) is a fresh reference every render and would re-create the whole game each time.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const target: CabnGameTarget =
			worldUrl !== undefined ? { worldUrl } : { shelfUrl: shelfUrl as string };
		const next = createCabnGame(container, target);
		setHandle(next);
		onGameReady?.(next);

		return () => {
			next.game.destroy(true);
			setHandle(null);
			onGameReady?.(null);
		};
		// worldUrl/shelfUrl changing is treated as a fresh game, not a hot-swap —
		// Phaser's scene graph doesn't cleanly support re-pointing an already-
		// booted world/shelf at a different bundle mid-flight.
	}, [worldUrl, shelfUrl]);

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />
			{handle && (
				<PixelTheme store={handle.store}>
					{/* First, so every HUD panel after it stacks above this in-world layer. */}
					<PortalLivePage store={handle.store} bus={handle.bus} />
					<FileOverlay store={handle.store} />
					<FileStatusLine store={handle.store} bus={handle.bus} />
					<PortalPreviewDock store={handle.store} />
					<ToolHotbar store={handle.store} bus={handle.bus} />
					<SpyglassPanel store={handle.store} bus={handle.bus} />
					<OrbSearch store={handle.store} bus={handle.bus} />
					<BagTray store={handle.store} bus={handle.bus} />
					<SettingsCorner store={handle.store} />
					<WorldMap store={handle.store} bus={handle.bus} />
					<MonsterCounter store={handle.store} />
					<EncounterBanner store={handle.store} />
					<VictoryToast store={handle.store} />
					<GuideDialog store={handle.store} />
					<EditorOverlay store={handle.store} bus={handle.bus} />
					<RunOverlay store={handle.store} bus={handle.bus} />
					<SceneTransitionOverlay store={handle.store} bus={handle.bus} />
				</PixelTheme>
			)}
		</div>
	);
}
