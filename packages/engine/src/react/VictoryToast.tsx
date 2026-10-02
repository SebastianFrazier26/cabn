import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { shouldShowVictoryToast } from "../systems/victoryTrigger.js";
import { useCabnStore } from "./useCabnStore.js";

export interface VictoryToastProps {
	store: StoreApi<CabnStore>;
}

const AUTO_DISMISS_MS = 3200;
const CONFETTI_COLORS = [
	{ tx: -70, ty: -60, rot: 180, color: "var(--cabn-accent-yellow)" },
	{ tx: 70, ty: -60, rot: -180, color: "var(--cabn-accent-pink)" },
	{ tx: -90, ty: 10, rot: 120, color: "var(--cabn-accent-cyan)" },
	{ tx: 90, ty: 10, rot: -120, color: "var(--cabn-accent-green)" },
	{ tx: -40, ty: 60, rot: 200, color: "var(--cabn-accent-orange)" },
	{ tx: 40, ty: 60, rot: -200, color: "var(--cabn-accent-violet)" },
];

/**
 * A small "Victory!" toast + confetti burst the instant the player's last
 * edit clears every remaining monster in the current world — see
 * MonsterCounter for the same `monsters`/`defeatedMonsterIds` read this uses
 * to compute "remaining". shouldShowVictoryToast (systems/victoryTrigger.ts)
 * is the one bit of real logic (fire only on the >0 -> 0 transition); this
 * component is the mount/timer/dismiss glue around it.
 */
export function VictoryToast({
	store,
}: VictoryToastProps): React.ReactElement | null {
	const monsters = useCabnStore(store, (s) => s.monsters);
	const defeatedMonsterIds = useCabnStore(store, (s) => s.defeatedMonsterIds);
	const remaining = monsters.filter(
		(m) => !defeatedMonsterIds.includes(m.id),
	).length;

	const previousRemainingRef = useRef<number | null>(null);
	const [visible, setVisible] = useState(false);
	const [playToken, setPlayToken] = useState(0);

	useEffect(() => {
		const previous = previousRemainingRef.current;
		previousRemainingRef.current = remaining;
		if (shouldShowVictoryToast(previous, remaining, monsters.length > 0)) {
			setVisible(true);
			setPlayToken((token) => token + 1);
		}
	}, [remaining, monsters.length]);

	useEffect(() => {
		if (!visible) return;
		const timeout = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
		const onKeyDown = () => setVisible(false);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			clearTimeout(timeout);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [visible]);

	if (!visible) return null;

	return (
		<div
			key={playToken}
			role="status"
			aria-live="polite"
			className="cabn-panel cabn-victory-toast play"
			style={{
				position: "absolute",
				top: "22%",
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 11,
				minWidth: 260,
				textAlign: "center",
				pointerEvents: "none",
			}}
		>
			<div className="cabn-ribbon victory">
				<div className="cabn-ribbon-shape" />
				<span>Victory!</span>
			</div>
			<p style={{ margin: "6px 0 0", fontSize: 12 }}>
				All bugs fixed in this world.
			</p>
			{CONFETTI_COLORS.map((c, i) => (
				<div
					// Fixed set, never reordered/added to at runtime — index is a stable
					// enough key, same reasoning as RunOverlay's append-only log.
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed, static list
					key={i}
					className="cabn-confetti"
					style={
						{
							"--cabn-tx": `${c.tx}px`,
							"--cabn-ty": `${c.ty}px`,
							"--cabn-rot": `${c.rot}deg`,
							background: c.color,
							animationDelay: `${i * 40}ms`,
						} as React.CSSProperties
					}
				/>
			))}
		</div>
	);
}
