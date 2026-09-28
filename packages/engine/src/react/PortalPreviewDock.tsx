import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import type { UrlDisplayPreview } from "../systems/archPreview.js";
import { canOpenPortalLink, openPortalLink } from "../systems/embedGuard.js";
import {
	type DockCandidateState,
	shouldDockLivePage,
} from "../systems/portalFx.js";
import { LIVE_SLOT_ATTR } from "./PortalLivePage.js";
import { PortalPreview } from "./PortalPreview.js";
import { SPARK_COLORS, usePortalFxStyles } from "./portalFxStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PortalPreviewDockProps {
	store: StoreApi<CabnStore>;
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
}: PortalPreviewDockProps): React.ReactElement | null {
	usePortalFxStyles();
	const focused = useCabnStore(store, (s) => s.focusedPortalPreview);
	const mode = useCabnStore(store, (s) => s.mode);
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const spyglassOpen = useCabnStore(store, (s) => s.spyglassOpen);
	const live = useCabnStore(store, (s) =>
		shouldDockLivePage(s as DockCandidateState),
	);
	const hasHistory = useCabnStore(store, (s) => s.git !== null);

	if (!focused || mode !== "world" || spyglassOpen || worldBase === null)
		return null;

	const { preview } = focused;
	const liveWeb = preview.kind === "url" && live;
	const compactWeb = preview.kind === "url" && !live && !preview.fallbackImage;

	return (
		<div
			key={focused.portalId}
			data-testid="portal-preview-dock"
			className="cabn-preview-dock"
			style={{
				position: "absolute",
				right: 16,
				top: "50%",
				transform: "translateY(-50%)",
				width: liveWeb ? "min(480px, 46vw)" : "min(440px, 42vw)",
				// Tall for a docked page (it's a real, scrollable site); shrink-
				// wrapped for a blocked site with no picture so the card isn't
				// mostly empty space.
				height: liveWeb
					? "min(640px, 84vh)"
					: compactWeb
						? "auto"
						: "min(380px, 58vh)",
				maxHeight: "84vh",
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
