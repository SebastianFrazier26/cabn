import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
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

	if (mode !== "encounter" || !activeMonsterId) return null;
	const monster = monsters.find((m) => m.id === activeMonsterId);
	if (!monster) return null;

	return (
		<div
			style={{
				position: "absolute",
				top: "18%",
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 9,
				minWidth: 280,
				maxWidth: 420,
				textAlign: "center",
				background: toCssColor(PALETTE.parchment),
				border: `3px solid ${toCssColor(PALETTE.ink)}`,
				borderRadius: 10,
				padding: "14px 20px",
				fontFamily: "Georgia, 'Iowan Old Style', serif",
				color: toCssColor(PALETTE.ink),
				boxShadow: "0 6px 18px rgba(50, 34, 20, 0.4)",
			}}
		>
			<div style={{ fontWeight: "bold", fontSize: 16, marginBottom: 6 }}>
				A {speciesDisplayName(monster.species)} appeared!
			</div>
			<div style={{ fontSize: 13, opacity: 0.85 }}>{monster.message}</div>
		</div>
	);
}
