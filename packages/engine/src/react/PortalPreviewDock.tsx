import type { RichPortalPreview } from "@cabn/world-schema";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import {
	canOpenPortalLink,
	openPortalLink,
	shouldMountEmbed,
} from "../systems/embedGuard.js";
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
 * A url preview gets a title card with an "Open in browser" button, not a
 * second iframe: by the time the dock opens, the live page is already
 * mounted over the arch itself (react/PortalLivePage.tsx, a wider radius),
 * and two frames of the same page would double the load for no gain. The
 * dock still carries the keyboard-reachable way to open the link.
 */
export function PortalPreviewDock({
	store,
}: PortalPreviewDockProps): React.ReactElement | null {
	usePortalFxStyles();
	const focused = useCabnStore(store, (s) => s.focusedPortalPreview);
	const mode = useCabnStore(store, (s) => s.mode);
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const spyglassOpen = useCabnStore(store, (s) => s.spyglassOpen);

	if (!focused || mode !== "world" || spyglassOpen || worldBase === null)
		return null;

	const { preview } = focused;

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
				width: "min(440px, 42vw)",
				height: "min(380px, 58vh)",
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
						preview={preview}
						fileName={focused.fileName}
						allowedEmbedOrigins={focused.allowedEmbedOrigins}
						worldBase={worldBase}
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
	preview,
	fileName,
	allowedEmbedOrigins,
	worldBase,
}: {
	preview: Extract<RichPortalPreview, { kind: "url" }>;
	fileName: string;
	allowedEmbedOrigins: readonly string[];
	worldBase: string;
}): React.ReactElement {
	const canOpen = canOpenPortalLink(preview.url, allowedEmbedOrigins);
	const liveInArch = shouldMountEmbed(preview.url, allowedEmbedOrigins, true);
	const shot = preview.fallbackImage
		? resolveRelativeUrl(worldBase, preview.fallbackImage)
		: undefined;
	return (
		<div className="cabn-panel cabn-web-card" data-testid="portal-web-card">
			<div className="cabn-panel-title">{fileName}</div>
			<div className="cabn-web-card-host">↗ {hostOf(preview.url)}</div>
			<div className="cabn-web-card-title">{preview.title ?? preview.url}</div>
			<div className="cabn-web-card-shot">
				{shot && <img src={shot} alt="" />}
			</div>
			{liveInArch && (
				<div className="cabn-web-card-hint">
					The live page is showing in the arch — click it to open.
				</div>
			)}
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
