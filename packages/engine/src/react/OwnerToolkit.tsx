import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import {
	digitPick,
	type OwnerToolkitEntry,
	stepPick,
} from "../systems/ownerToolkit.js";
import { KEYBOARD_OWNER_ATTR } from "../systems/uiFocus.js";
import { iconFallback, useLayerIcon } from "./layerIcons.js";
import { useOwnerToolkitStyles } from "./ownerToolkitStyles.js";

export interface OwnerToolkitProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	entries: readonly OwnerToolkitEntry[];
}

/**
 * The owner's toolkit: a small menu above the hotbar's owner slot listing
 * whatever the owner capability offers. It renders only the generic entries
 * systems/ownerToolkit.ts builds, so nothing here knows what a layer is.
 */
export function OwnerToolkit({
	store,
	bus,
	entries,
}: OwnerToolkitProps): React.ReactElement {
	useOwnerToolkitStyles();
	const rootRef = useRef<HTMLDivElement>(null);
	const [picked, setPicked] = useState(0);
	const pickedRef = useRef(picked);
	pickedRef.current = picked;
	const entriesRef = useRef(entries);
	entriesRef.current = entries;

	const iconFor = useLayerIcon(store);
	const close = () => store.getState().setOwnerToolkitOpen(false);
	const confirm = (entry: OwnerToolkitEntry | undefined) => {
		if (!entry) return;
		// Closed first: a git entry opens the rift's picker, which refuses to
		// open over another modal.
		close();
		entry.run({ store, bus });
	};
	const confirmRef = useRef(confirm);
	confirmRef.current = confirm;

	// Focus inside a KEYBOARD_OWNER_ATTR panel is what makes the focus gate
	// switch Phaser's keyboard off (and reset held keys, so a held W stops
	// walking) and keeps the hotbar and the pensieve's H out while open.
	useEffect(() => {
		const root = rootRef.current;
		const previous =
			typeof document !== "undefined" ? document.activeElement : null;
		root?.focus({ preventScroll: true });
		return () => {
			if (root?.contains(document.activeElement)) {
				(document.activeElement as HTMLElement | null)?.blur();
				if (previous instanceof HTMLElement && previous !== document.body)
					previous.focus({ preventScroll: true });
			}
		};
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// Capture phase, like the git panels: while open the toolkit owns
			// every key, and Phaser, the hotbar and the pensieve never see one.
			event.stopPropagation();
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const list = entriesRef.current;
			const key = event.key;
			if (key === "Escape" || key.toLowerCase() === "o") {
				event.preventDefault();
				store.getState().setOwnerToolkitOpen(false);
				return;
			}
			if (key === "ArrowDown" || key === "ArrowUp") {
				event.preventDefault();
				setPicked(
					stepPick(
						pickedRef.current,
						key === "ArrowDown" ? 1 : -1,
						list.length,
					),
				);
				return;
			}
			const digit = digitPick(key, list.length);
			if (digit !== null) {
				event.preventDefault();
				setPicked(digit);
				return;
			}
			if (key === "Enter" || key === " ") {
				event.preventDefault();
				if (!event.repeat) confirmRef.current(list[pickedRef.current]);
				return;
			}
			if (key === "Tab") event.preventDefault();
		};
		const onPointerDown = (event: PointerEvent) => {
			const root = rootRef.current;
			const target = event.target as Node | null;
			if (!root || !target || root.contains(target)) return;
			// The owner slot toggles the menu itself; closing here as well would
			// reopen it on the same click.
			if ((target as Element).closest?.('[data-tool="owner"]')) return;
			store.getState().setOwnerToolkitOpen(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [store]);

	useEffect(() => {
		if (picked >= entries.length) setPicked(0);
	}, [picked, entries.length]);

	let lastGroup: string | null = null;
	return (
		<div
			ref={rootRef}
			role="menu"
			aria-label="Owner's toolkit"
			tabIndex={-1}
			data-testid="owner-toolkit"
			className="cabn-owner-toolkit"
			{...{ [KEYBOARD_OWNER_ATTR]: "" }}
		>
			<div className="cabn-owner-toolkit-title">Owner's toolkit</div>
			<ul>
				{entries.map((entry, index) => {
					const heading =
						entry.group !== null && entry.group !== lastGroup
							? entry.group
							: null;
					lastGroup = entry.group;
					return (
						<li key={entry.id}>
							{heading && (
								<div className="cabn-owner-toolkit-group">{heading}</div>
							)}
							<button
								type="button"
								role="menuitem"
								tabIndex={-1}
								data-entry={entry.id}
								data-picked={index === picked ? "true" : undefined}
								className={`cabn-owner-toolkit-row${index === picked ? " picked" : ""}`}
								onPointerEnter={() => setPicked(index)}
								onClick={() => confirm(entry)}
							>
								<kbd>{index + 1}</kbd>
								{entry.icon ? (
									<img
										src={iconFor(entry.icon)}
										alt=""
										onError={iconFallback(entry.icon)}
									/>
								) : (
									<span
										className="cabn-owner-toolkit-glyph"
										aria-hidden="true"
									/>
								)}
								<span className="cabn-owner-toolkit-text">
									<span className="cabn-owner-toolkit-label">
										{entry.label}
									</span>
									<span className="cabn-owner-toolkit-detail">
										{entry.detail}
									</span>
								</span>
								{entry.active && (
									<span className="cabn-owner-toolkit-on">on</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>
			<div className="cabn-owner-toolkit-hint">
				↑↓ or 1–{entries.length} pick · Enter use · Esc close
			</div>
		</div>
	);
}
