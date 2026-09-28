import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { useCabnStore } from "./useCabnStore.js";

export interface MonsterCounterProps {
	store: StoreApi<CabnStore>;
}

/** Bottom-left HUD readout — hidden entirely for a world with no monsters at all (e.g. notes-vault, see the M6 CHANGELOG) rather than announcing "0 bugs remain" for a place that was never buggy. */
export function MonsterCounter({
	store,
}: MonsterCounterProps): React.ReactElement | null {
	const monsters = useCabnStore(store, (s) => s.monsters);
	const defeatedMonsterIds = useCabnStore(store, (s) => s.defeatedMonsterIds);
	const mode = useCabnStore(store, (s) => s.mode);

	if (monsters.length === 0) return null;
	if (mode === "editor" || mode === "encounter") return null;

	const remaining = monsters.filter(
		(m) => !defeatedMonsterIds.includes(m.id),
	).length;

	return (
		<div
			className="cabn-panel cabn-hud-pill"
			style={{
				position: "absolute",
				bottom: 16,
				left: 16,
				zIndex: 5,
				fontSize: 12,
			}}
		>
			{remaining === 0
				? "All bugs fixed in this world!"
				: `${remaining} bug${remaining === 1 ? "" : "s"} remain in this world`}
		</div>
	);
}
