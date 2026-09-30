/**
 * The encounter popup's dismissal rule (EncounterBanner.tsx / FileScene's
 * onEncounterContinue): pure so it's unit-testable without mounting React or
 * Phaser. It used to be a fixed timer with one exit (Esc, cancel); now every
 * input dismisses it, split two ways — Esc alone cancels back to plain file
 * mode, anything else (a click, Enter/Space, any other key) continues into
 * whatever the encounter was for (the quill, at the monster's line).
 */
export type EncounterDismissal = "close" | "continue";

export interface KeyDismissalInput {
	key: string;
	/** A held Cmd/Ctrl/Alt chord (browser refresh, devtools, ...) isn't a dismissal at all — it should reach the browser untouched. */
	modifierHeld: boolean;
	/** The same key already held from the frame before — holding Enter from the Alt+Enter that opened this shouldn't fire a second continue once the listener attaches. */
	repeat: boolean;
}

/** `null` means "not a dismissal, let the event through" (a modifier chord, a held repeat). */
export function keyDismissal(
	input: KeyDismissalInput,
): EncounterDismissal | null {
	if (input.modifierHeld) return null;
	if (input.key === "Escape") return "close";
	if (input.repeat) return null;
	return "continue";
}

/**
 * Whether a dismiss-to-continue should actually open the quill: the encounter
 * it was for might already be over (a second dismissal racing in, or a save
 * that defeated the monster while the popup was still up) by the time it's
 * handled, and the monster it names might already be gone from this file's
 * live list (defeated, or the buffer having moved on).
 */
export function shouldContinueEncounter(params: {
	mode: string;
	activeMonsterId: string | null;
	dismissedMonsterId: string;
	monsterStillPresent: boolean;
}): boolean {
	return (
		params.mode === "encounter" &&
		params.activeMonsterId === params.dismissedMonsterId &&
		params.monsterStillPresent
	);
}
