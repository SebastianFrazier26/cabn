import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import type { TimeOfDayOverride } from "../systems/timeOfDay.js";
import { persistTimeOfDayOverride } from "../systems/timeOfDaySettings.js";
import { useCabnStore } from "./useCabnStore.js";

const OPTIONS: ReadonlyArray<{
	value: TimeOfDayOverride;
	label: string;
	title: string;
}> = [
	{ value: "auto", label: "Auto", title: "follow your clock (day 6am-6pm)" },
	{ value: "day", label: "Day", title: "always day" },
	{ value: "night", label: "Night", title: "always night" },
];

export interface SettingsCornerProps {
	store: StoreApi<CabnStore>;
}

/**
 * The one user setting: auto/day/night (2026-09-28 — glow is always on now,
 * and "reset world" moved into the spyglass panel, next to the per-file
 * resets, since it's a world action rather than a setting). A three-way
 * segmented control rather than the old cycle-on-click pill, so the current
 * choice and the other two are all visible at once. Hidden while the editor
 * is open, same as the hotbar.
 */
export function SettingsCorner({
	store,
}: SettingsCornerProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const override = useCabnStore(store, (s) => s.timeOfDayOverride);

	if (mode === "editor") return null;

	return (
		<fieldset
			className="cabn-pill-button cabn-segmented"
			aria-label="time of day"
			style={{
				position: "absolute",
				top: 16,
				left: 16,
				zIndex: 6,
				margin: 0,
				padding: 3,
				display: "flex",
				gap: 2,
				cursor: "default",
				// PixelTheme's wrapper is pointerEvents: "none" so it never blocks the
				// canvas underneath — this corner has real click targets, so it opts
				// back in explicitly.
				pointerEvents: "auto",
			}}
		>
			{OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					title={option.title}
					aria-pressed={override === option.value}
					className={override === option.value ? "selected" : undefined}
					onClick={(event) => {
						store.getState().setTimeOfDayOverride(option.value);
						persistTimeOfDayOverride(option.value);
						// A mouse click would otherwise leave focus on this button,
						// and the next Enter meant for the world would re-click it.
						event.currentTarget.blur();
					}}
				>
					{option.label}
				</button>
			))}
		</fieldset>
	);
}
