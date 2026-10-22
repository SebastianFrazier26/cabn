import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { DOCK_MARGIN_PX } from "../systems/dockPlacement.js";
import { openShowcaseLink } from "../systems/embedGuard.js";
import { usePortalFxStyles } from "./portalFxStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface ShelfWorldCardProps {
	store: StoreApi<CabnStore>;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/**
 * The shelf's answer to the world's web-portal title card: walking up to a
 * cabin whose world has showcase info (shelf.json description, links, hero
 * url) shows it in the same panel, in the dock's spot. A cabin without any
 * shows nothing, so a shelf built before showcase.json looks as it did.
 */
export function ShelfWorldCard({
	store,
}: ShelfWorldCardProps): React.ReactElement | null {
	usePortalFxStyles();
	const world = useCabnStore(store, (s) => s.nearShelfWorld);
	if (!world) return null;
	const links = world.links ?? [];
	if (!world.description && links.length === 0 && !world.heroUrl) return null;

	return (
		<div
			key={world.id}
			data-testid="shelf-world-card"
			className="cabn-preview-dock"
			style={{
				position: "absolute",
				right: DOCK_MARGIN_PX,
				top: "50%",
				transform: "translateY(-50%)",
				width: "min(360px, 40vw)",
				maxHeight: "70vh",
				display: "flex",
				flexDirection: "column",
				// PixelTheme's wrapper is click-through; the links are buttons.
				pointerEvents: "auto",
			}}
		>
			<div className="cabn-dock-open">
				<div className="cabn-panel cabn-web-card">
					<div className="cabn-panel-title">{world.name}</div>
					{world.heroUrl && (
						<div className="cabn-web-card-host">↗ {hostOf(world.heroUrl)}</div>
					)}
					{world.description && (
						<div
							className="cabn-web-card-title"
							data-testid="shelf-world-description"
						>
							{world.description}
						</div>
					)}
					{links.map((link) => (
						<button
							key={`${link.label}\u0000${link.url}`}
							type="button"
							className="cabn-btn neutral"
							onClick={(e) => {
								e.currentTarget.blur();
								openShowcaseLink(link.url);
							}}
						>
							{link.label} ↗
						</button>
					))}
					<div className="cabn-web-card-hint">
						Enter, or click the cabin, to step inside.
					</div>
				</div>
			</div>
		</div>
	);
}
