import { useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { persistGlowEnabled } from "../systems/glowSettings.js";
import type { TimeOfDayOverride } from "../systems/timeOfDay.js";
import { persistTimeOfDayOverride } from "../systems/timeOfDaySettings.js";
import { useCabnStore } from "./useCabnStore.js";

const NEXT_TIME_OF_DAY_OVERRIDE: Record<TimeOfDayOverride, TimeOfDayOverride> =
	{
		auto: "day",
		day: "night",
		night: "auto",
	};

export interface SettingsCornerProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * A single "reset this world" escape hatch, tucked in a corner rather than a
 * full settings panel (there's nothing else to configure yet). Hidden while
 * the editor is open, same as the hotbar — resetting mid-edit out from under
 * an open buffer would be confusing, and there's nothing here you can't do a
 * moment later once you've closed it.
 */
export function SettingsCorner({
	store,
	bus,
}: SettingsCornerProps): React.ReactElement | null {
	const mode = useCabnStore(store, (s) => s.mode);
	const glowEnabled = useCabnStore(store, (s) => s.glowEnabled);
	const timeOfDayOverride = useCabnStore(store, (s) => s.timeOfDayOverride);
	const [confirming, setConfirming] = useState(false);

	if (mode === "editor") return null;

	return (
		<div
			style={{
				position: "absolute",
				top: 16,
				left: 16,
				zIndex: 6,
				display: "flex",
				alignItems: "flex-start",
				gap: 8,
				// PixelTheme's wrapper is pointerEvents: "none" so it never blocks the
				// canvas underneath — this corner has real click targets, so it opts
				// back in explicitly.
				pointerEvents: "auto",
			}}
		>
			<button
				type="button"
				className="cabn-pill-button"
				title="toggle glow"
				onClick={() => {
					const next = !glowEnabled;
					store.getState().setGlowEnabled(next);
					persistGlowEnabled(next);
				}}
			>
				Glow: {glowEnabled ? "on" : "off"}
			</button>
			<button
				type="button"
				className="cabn-pill-button"
				title="cycle day/night (auto follows your clock)"
				onClick={() => {
					const next = NEXT_TIME_OF_DAY_OVERRIDE[timeOfDayOverride];
					store.getState().setTimeOfDayOverride(next);
					persistTimeOfDayOverride(next);
				}}
			>
				{timeOfDayOverride === "auto"
					? "Auto"
					: timeOfDayOverride === "day"
						? "Day"
						: "Night"}
			</button>
			{confirming ? (
				<div
					className="cabn-panel"
					style={{
						fontSize: 12,
						display: "flex",
						flexDirection: "column",
						gap: 8,
						padding: 10,
					}}
				>
					<span>Reset all saved edits for this world?</span>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							type="button"
							className="cabn-btn neutral"
							onClick={() => {
								bus.emit("tool:reset-world", {});
								setConfirming(false);
							}}
							style={{ padding: "3px 10px" }}
						>
							Reset
						</button>
						<button
							type="button"
							className="cabn-btn cancel"
							onClick={() => setConfirming(false)}
							style={{ padding: "3px 10px" }}
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					className="cabn-pill-button"
					title="reset world"
					onClick={() => setConfirming(true)}
					style={{ width: 32, height: 32, borderRadius: "50%", padding: 0 }}
				>
					⚙
				</button>
			)}
		</div>
	);
}
