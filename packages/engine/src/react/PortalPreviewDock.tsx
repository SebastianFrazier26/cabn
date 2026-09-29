import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus, CabnEvents } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import type { UrlDisplayPreview } from "../systems/archPreview.js";
import {
	DOCK_MARGIN_PX,
	type DockSide,
	placeDock,
} from "../systems/dockPlacement.js";
import { canOpenPortalLink, openPortalLink } from "../systems/embedGuard.js";
import {
	type DockCandidateState,
	previewDockOpen,
	shouldDockLivePage,
} from "../systems/portalFx.js";
import { LIVE_SLOT_ATTR } from "./PortalLivePage.js";
import { PortalPreview } from "./PortalPreview.js";
import { SPARK_COLORS, usePortalFxStyles } from "./portalFxStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PortalPreviewDockProps {
	store: StoreApi<CabnStore>;
	/** Without it the dock never moves off a url arch it covers (see useDockPlacement). */
	bus?: CabnBus;
}

/**
 * The expanded preview for whichever world portal the player is standing at
 * (WorldScene sets `focusedPortalPreview` inside PORTAL_FOCUS_RADIUS and
 * clears it on leaving). The in-arch preview is a static canvas snapshot
 * (render/archPreviews.ts); this is the full, scrollable view — CodeMirror
 * for code, rendered markdown, the full image.
 *
 * A url preview never gets a second iframe here. When the live page exists
 * (PortalLivePage, mounted from a wider radius), the dock renders an empty
 * slot and that same iframe moves over it at a readable size — one frame,
 * one network load. When it can't exist (embeds.json says the site refuses
 * framing, or the origin isn't allowlisted) the dock shows the fallback
 * card. Either way it carries the keyboard-reachable "Open in browser".
 */
export function PortalPreviewDock({
	store,
	bus,
}: PortalPreviewDockProps): React.ReactElement | null {
	usePortalFxStyles();
	const focused = useCabnStore(store, (s) => s.focusedPortalPreview);
	const open = useCabnStore(store, previewDockOpen);
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const live = useCabnStore(store, (s) =>
		shouldDockLivePage(s as DockCandidateState),
	);
	const hasHistory = useCabnStore(store, (s) => s.git !== null);
	const placement = useDockPlacement(
		bus,
		open ? (focused?.portalId ?? null) : null,
		focused?.preview.kind === "url" && live,
	);

	if (!focused || !open || worldBase === null) return null;

	const { preview } = focused;
	const liveWeb = preview.kind === "url" && live;
	const compactWeb = preview.kind === "url" && !live && !preview.fallbackImage;
	const height = liveWeb
		? "min(640px, 84vh)"
		: compactWeb
			? "auto"
			: "min(380px, 58vh)";

	return (
		<div
			key={focused.portalId}
			ref={placement.ref}
			data-testid="portal-preview-dock"
			data-dock-side={placement.side}
			className="cabn-preview-dock"
			style={{
				position: "absolute",
				...(placement.side === "left"
					? // The left edge carries the settings corner above and the
						// monster counter and hotbar below, all stacked over the dock,
						// so a dock moved there sits between them rather than
						// centred.
						{
							left: DOCK_MARGIN_PX,
							top: DOCK_LEFT_TOP_PX,
							maxHeight: `calc(100% - ${DOCK_LEFT_TOP_PX + DOCK_LEFT_BOTTOM_PX}px)`,
						}
					: {
							right: DOCK_MARGIN_PX,
							top: "50%",
							transform: "translateY(-50%)",
							maxHeight: "84vh",
						}),
				width:
					placement.width ??
					(liveWeb ? "min(480px, 46vw)" : "min(440px, 42vw)"),
				// Tall for a docked page (it's a real, scrollable site); shrink-
				// wrapped for a blocked site with no picture so the card isn't
				// mostly empty space.
				height,
				display: "flex",
				flexDirection: "column",
				// PixelTheme's wrapper is click-through; the dock has a button and
				// scrollable content, and a click on it shouldn't walk the player.
				pointerEvents: "auto",
			}}
		>
			<div className="cabn-dock-open">
				{preview.kind === "url" ? (
					<WebPortalCard
						portalId={focused.portalId}
						preview={preview}
						fileName={focused.fileName}
						allowedEmbedOrigins={focused.allowedEmbedOrigins}
						worldBase={worldBase}
						live={live}
					/>
				) : (
					<PortalPreview
						preview={preview}
						fileName={focused.fileName}
						worldBaseUrl={worldBase}
						variant="expanded"
					/>
				)}
			</div>
			{hasHistory && (
				<button
					type="button"
					className="cabn-btn neutral"
					data-testid="dock-pensieve"
					style={{ alignSelf: "flex-end", marginTop: 6 }}
					onClick={(e) => {
						e.currentTarget.blur();
						store.getState().setPensievePortalId(focused.portalId);
					}}
				>
					Pensieve: file history (H)
				</button>
			)}
			<DockSparks />
		</div>
	);
}

const DOCK_LEFT_TOP_PX = 104;
const DOCK_LEFT_BOTTOM_PX = 88;

interface PlacementState {
	side: DockSide;
	/** null: the usual responsive CSS width, untouched. */
	width: number | null;
}

const USUAL: PlacementState = { side: "right", width: null };

/**
 * Re-placed from the url arch's per-frame screen rect (WorldScene's
 * "portal:web-rect", which carries the keepout), so it follows the arch as
 * the camera does; only a changed result re-renders. Other portal kinds get
 * no rect and keep the usual spot.
 */
function useDockPlacement(
	bus: CabnBus | undefined,
	portalId: string | null,
	liveWeb: boolean,
): PlacementState & { ref: React.RefObject<HTMLDivElement | null> } {
	const ref = useRef<HTMLDivElement>(null);
	const [placement, setPlacement] = useState<PlacementState>(USUAL);
	const liveWebRef = useRef(liveWeb);
	liveWebRef.current = liveWeb;

	useEffect(() => {
		setPlacement(USUAL);
		if (!bus || !portalId) return;
		const onRect = (e: CabnEvents["portal:web-rect"]) => {
			if (e.portalId !== portalId) return;
			const dock = ref.current;
			const parent = dock?.offsetParent;
			if (!dock || !parent) return;
			// Mirrors the CSS widths below, which are relative to the viewport.
			const vw = window.innerWidth;
			const preferred = liveWebRef.current
				? Math.min(480, 0.46 * vw)
				: Math.min(440, 0.42 * vw);
			const box = dock.getBoundingClientRect();
			const top = parent.getBoundingClientRect().top;
			const next = placeDock(
				parent.clientWidth,
				preferred,
				{ top: box.top - top, bottom: box.bottom - top },
				e.keepout,
			);
			const width =
				next.side === "right" && next.width === preferred ? null : next.width;
			setPlacement((prev) =>
				prev.side === next.side && prev.width === width
					? prev
					: { side: next.side, width },
			);
		};
		bus.on("portal:web-rect", onRect);
		return () => bus.off("portal:web-rect", onRect);
	}, [bus, portalId]);

	return { ...placement, ref };
}

const SPARKS = 10;

function DockSparks(): React.ReactElement {
	return (
		<div className="cabn-dock-sparks" aria-hidden="true">
			{Array.from({ length: SPARKS }, (_, i) => {
				const angle = (i / SPARKS) * Math.PI * 2;
				const dist = 26 + (i % 3) * 14;
				return (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed decorative set, never reordered
						key={i}
						style={
							{
								top: `${12 + ((i * 37) % 76)}%`,
								background: SPARK_COLORS[i % SPARK_COLORS.length],
								"--cabn-tx": `${Math.round(Math.cos(angle) * dist - 20)}px`,
								"--cabn-ty": `${Math.round(Math.sin(angle) * dist)}px`,
								"--cabn-delay": `${(i % 5) * 45}ms`,
							} as React.CSSProperties
						}
					/>
				);
			})}
		</div>
	);
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function WebPortalCard({
	portalId,
	preview,
	fileName,
	allowedEmbedOrigins,
	worldBase,
	live,
}: {
	portalId: string;
	preview: UrlDisplayPreview;
	fileName: string;
	allowedEmbedOrigins: readonly string[];
	worldBase: string;
	live: boolean;
}): React.ReactElement {
	const canOpen = canOpenPortalLink(preview.url, allowedEmbedOrigins);
	const shot = preview.fallbackImage
		? resolveRelativeUrl(worldBase, preview.fallbackImage)
		: undefined;
	const hint = live
		? "Scroll and click inside the page. Click anywhere outside it to walk again."
		: preview.embedBlocked
			? "This site doesn't allow itself to be shown inside other pages — open it in your browser instead."
			: canOpen
				? "This page can't be shown here — open it in your browser instead."
				: "This page can't be shown or opened from this world.";
	return (
		<div
			className="cabn-panel cabn-web-card"
			data-testid="portal-web-card"
			data-live={String(live)}
			data-blocked={String(Boolean(preview.embedBlocked))}
		>
			<div className="cabn-panel-title">{fileName}</div>
			<div className="cabn-web-card-host">↗ {hostOf(preview.url)}</div>
			<div className="cabn-web-card-title">{preview.title ?? preview.url}</div>
			{live ? (
				<div
					className="cabn-web-live-slot"
					data-testid="portal-web-live-slot"
					{...{ [LIVE_SLOT_ATTR]: portalId }}
				/>
			) : (
				shot && (
					<div className="cabn-web-card-shot">
						<img src={shot} alt="" />
					</div>
				)
			)}
			<div className="cabn-web-card-hint" data-testid="portal-web-hint">
				{hint}
			</div>
			{canOpen && (
				<button
					type="button"
					className="cabn-btn neutral"
					data-testid="portal-web-open"
					onClick={(e) => {
						e.currentTarget.blur();
						openPortalLink(preview.url, allowedEmbedOrigins);
					}}
				>
					Open in browser ↗
				</button>
			)}
		</div>
	);
}
