import { useEffect, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { speciesDisplayName } from "../systems/monsterDisplay.js";
import { useCabnStore } from "./useCabnStore.js";

export interface EncounterBannerProps {
	store: StoreApi<CabnStore>;
}

/**
 * The short "a monster appeared" beat between walking into a monster and the
 * quill opening (see FileScene's startEncounterFor — this banner is purely
 * cosmetic, the actual mode/timer transition lives there). Reads the
 * encountered monster off `store.monsters`, the same flat summary the HUD
 * counter uses, rather than holding its own copy.
 */
export function EncounterBanner({
	store,
}: EncounterBannerProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const activeMonsterId = useCabnStore(store, (s) => s.activeMonsterId);
	const monsters = useCabnStore(store, (s) => s.monsters);

	// Remounting the shake+flash (key={playToken}) on every new encounter is
	// what retriggers its CSS animation, same "remount == retrigger" pattern
	// RunOverlay's own unfurl animation already relies on.
	const [playToken, setPlayToken] = useState(0);
	useEffect(() => {
		if (mode === "encounter") setPlayToken((token) => token + 1);
	}, [mode]);

	if (mode !== "encounter" || !activeMonsterId) return null;
	const monster = monsters.find((m) => m.id === activeMonsterId);
	if (!monster) return null;

	return (
		<div
			key={playToken}
			className="cabn-panel cabn-encounter-card play"
			style={{
				position: "absolute",
				top: "18%",
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 9,
				minWidth: 280,
				maxWidth: 420,
				textAlign: "center",
			}}
		>
			<div className="cabn-encounter-flash" />
			<div className="cabn-ribbon">
				<div className="cabn-ribbon-shape" />
				<span>A {speciesDisplayName(monster.species)} appeared!</span>
			</div>
			<p style={{ margin: "6px 0 0", fontSize: 13 }}>{monster.message}</p>
		</div>
	);
}
