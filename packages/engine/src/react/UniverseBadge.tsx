import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { cssColor, universeTint } from "../systems/gitHistory.js";
import { useCabnStore } from "./useCabnStore.js";

/** Which universe (branch) this world is — always visible in a world with history, tinted like the universe itself. */
export function UniverseBadge({
	store,
}: {
	store: StoreApi<CabnStore>;
}): React.ReactElement | null {
	const git = useCabnStore(store, (s) => s.git);
	const mode = useCabnStore(store, (s) => s.mode);
	if (!git || mode !== "world") return null;
	const tint = universeTint(git.universe?.slug ?? null);
	return (
		<div
			data-testid="universe-badge"
			data-universe={git.universe?.slug ?? "main"}
			className="cabn-panel cabn-hud-pill"
			style={{
				position: "absolute",
				top: 12,
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 5,
				padding: "6px 14px",
				pointerEvents: "none",
				borderColor: tint !== null ? cssColor(tint) : undefined,
			}}
		>
			<span
				aria-hidden
				style={{
					width: 12,
					height: 12,
					borderRadius: 6,
					display: "inline-block",
					background:
						tint !== null ? cssColor(tint) : "var(--cabn-accent-yellow)",
					border: "2px solid var(--cabn-border-outer)",
				}}
			/>
			<span>
				Universe: <strong>{git.branch}</strong>
				{git.universe ? "" : " (main)"}
			</span>
		</div>
	);
}
