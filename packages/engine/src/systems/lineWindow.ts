/**
 * Which line indices FileScene should have live Text objects for, given the
 * camera's current vertical scroll — the core of not creating one GameObject
 * per source line. `end` is exclusive, mirroring Array.slice semantics.
 */
export interface LineWindow {
	start: number;
	end: number;
}

export function computeLineWindow(
	scrollY: number,
	viewportHeight: number,
	lineHeight: number,
	totalLines: number,
	bufferLines: number,
): LineWindow {
	if (totalLines <= 0 || lineHeight <= 0) return { start: 0, end: 0 };

	const firstVisible = Math.floor(scrollY / lineHeight) - bufferLines;
	const lastVisible =
		Math.ceil((scrollY + viewportHeight) / lineHeight) + bufferLines;

	const start = Math.max(0, firstVisible);
	const end = Math.min(totalLines, lastVisible + 1);
	return { start, end: Math.max(start, end) };
}

export function lineWindowsEqual(a: LineWindow, b: LineWindow): boolean {
	return a.start === b.start && a.end === b.end;
}
