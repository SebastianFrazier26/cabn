// Pure decision behind VictoryToast.tsx: "did the player's last defeat just
// clear every bug in this world" — factored out of the component so the
// transition logic (as opposed to the toast's own mount/timer/DOM plumbing,
// which is UI glue per this repo's testing convention) has a real unit test.

/**
 * True exactly on the render where `remaining` first reaches zero after
 * having been above it — never on first mount already at zero (a revisited,
 * already-cleared world shouldn't re-toast every time it's entered) and
 * never for a world that never had any monsters at all (MonsterCounter hides
 * itself for those; the toast should too).
 */
export function shouldShowVictoryToast(
	previousRemaining: number | null,
	remaining: number,
	hadMonsters: boolean,
): boolean {
	if (!hadMonsters) return false;
	if (previousRemaining === null) return false;
	return previousRemaining > 0 && remaining === 0;
}
