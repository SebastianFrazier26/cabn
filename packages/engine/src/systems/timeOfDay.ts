export type TimeOfDay = "day" | "night";
export type TimeOfDayOverride = "auto" | "day" | "night";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;

/** Pure: local-clock hour (0-23) -> phase. Day is 06:00-18:00, matching the batch-2 brief's own wording. */
export function phaseFromHour(hour: number): TimeOfDay {
	return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? "day" : "night";
}

/** `override` wins outright when it's not "auto" — the whole point of a manual override is that it isn't second-guessed against the clock. */
export function resolveTimeOfDay(
	override: TimeOfDayOverride,
	now: Date = new Date(),
): TimeOfDay {
	if (override !== "auto") return override;
	return phaseFromHour(now.getHours());
}
