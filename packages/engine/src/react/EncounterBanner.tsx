import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { keyDismissal } from "../systems/encounterPopup.js";
import { speciesDisplayName } from "../systems/monsterDisplay.js";
import { KEYBOARD_OWNER_ATTR } from "../systems/uiFocus.js";
import { useCabnStore } from "./useCabnStore.js";

export interface EncounterBannerProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * The "a monster appeared" popup between clicking (or Alt+Enter beside) a
 * monster and the quill opening. Used to auto-advance on a fixed timer
 * (FileScene's old startEncounterFor) regardless of whether the player had
 * even read it yet — 2026-09-29: it now stays up and owns the keyboard
 * (KEYBOARD_OWNER_ATTR, same as OwnerToolkit) until the player dismisses it.
 * Esc alone calls store.endEncounter() and stops there; anything else (a
 * click, Enter/Space, any other key) fires encounter:continue, which
 * FileScene (the one place that knows the monster's line/language) turns
 * into the same openEditor() call the old timer used to make.
 */
export function EncounterBanner({
	store,
	bus,
}: EncounterBannerProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const activeMonsterId = useCabnStore(store, (s) => s.activeMonsterId);
	const monsters = useCabnStore(store, (s) => s.monsters);
	const rootRef = useRef<HTMLDivElement>(null);

	// Remounting the shake+flash (key={playToken}) on every new encounter is
	// what retriggers its CSS animation, same "remount == retrigger" pattern
	// RunOverlay's own unfurl animation already relies on.
	const [playToken, setPlayToken] = useState(0);
	useEffect(() => {
		if (mode === "encounter") setPlayToken((token) => token + 1);
	}, [mode]);

	// Grabs focus (which is what actually switches Phaser's keyboard off —
	// see render/keyboardFocusGate.ts) and owns every key/click until the
	// encounter ends, the same shape OwnerToolkit's own focus effect uses.
	// Scoped to [mode, activeMonsterId] rather than mount/unmount since this
	// component itself never unmounts — only the popup's own key={playToken}
	// child does, one render before this effect's dependencies change.
	useEffect(() => {
		if (mode !== "encounter" || !activeMonsterId) return;
		const root = rootRef.current;
		const previous =
			typeof document !== "undefined" ? document.activeElement : null;
		root?.focus({ preventScroll: true });

		const continueEncounter = () =>
			bus.emit("encounter:continue", { monsterId: activeMonsterId });
		const onKeyDown = (event: KeyboardEvent) => {
			const dismissal = keyDismissal({
				key: event.key,
				modifierHeld: event.metaKey || event.ctrlKey || event.altKey,
				repeat: event.repeat,
			});
			// null: a held Cmd/Ctrl/Alt chord or a held-key repeat — let it
			// through untouched (browser shortcut, or the Enter that opened a
			// keyboard-driven Alt+Enter encounter still being held).
			if (dismissal === null) return;
			event.stopPropagation();
			event.preventDefault();
			if (dismissal === "close") store.getState().endEncounter();
			else continueEncounter();
		};
		const onPointerDown = () => continueEncounter();
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("pointerdown", onPointerDown, true);
			if (root?.contains(document.activeElement)) {
				(document.activeElement as HTMLElement | null)?.blur();
				if (previous instanceof HTMLElement && previous !== document.body)
					previous.focus({ preventScroll: true });
			}
		};
	}, [mode, activeMonsterId, store, bus]);

	if (mode !== "encounter" || !activeMonsterId) return null;
	const monster = monsters.find((m) => m.id === activeMonsterId);
	if (!monster) return null;

	return (
		<div
			key={playToken}
			ref={rootRef}
			role="alertdialog"
			aria-label={`A ${speciesDisplayName(monster.species)} appeared`}
			tabIndex={-1}
			data-testid="cabn-encounter-popup"
			className="cabn-panel cabn-encounter-card play"
			{...{ [KEYBOARD_OWNER_ATTR]: "" }}
			style={{
				position: "absolute",
				top: "18%",
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 9,
				minWidth: 280,
				maxWidth: 420,
				textAlign: "center",
				pointerEvents: "auto",
			}}
		>
			<div className="cabn-encounter-flash" />
			<div className="cabn-ribbon">
				<div className="cabn-ribbon-shape" />
				<span>A {speciesDisplayName(monster.species)} appeared!</span>
			</div>
			<p style={{ margin: "6px 0 0", fontSize: 13 }}>{monster.message}</p>
			<p
				style={{
					margin: "10px 0 0",
					fontSize: 11,
					color: "var(--cabn-text-secondary)",
				}}
			>
				Enter to fight · Esc to close
			</p>
		</div>
	);
}
