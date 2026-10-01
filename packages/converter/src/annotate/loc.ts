// Annotators call locAt once per finding, and a crafted file can hold tens of
// thousands of findings; scanning from 0 each time was quadratic. The line
// table for the most recent content is kept, since every caller works
// through one file at a time.
let cachedContent: string | undefined;
let cachedLineStarts: number[] = [];

function lineStartsOf(content: string): number[] {
	if (content === cachedContent) return cachedLineStarts;
	const starts = [0];
	for (
		let i = content.indexOf("\n");
		i !== -1;
		i = content.indexOf("\n", i + 1)
	)
		starts.push(i + 1);
	cachedContent = content;
	cachedLineStarts = starts;
	return starts;
}

/**
 * Converts a character offset into a 0-based {line, col} — the convention
 * every annotator and the engine's line arrays share (see types.ts).
 */
export function locAt(
	content: string,
	index: number,
): { line: number; col: number } {
	const end = Math.max(0, Math.min(index, content.length));
	const starts = lineStartsOf(content);
	let lo = 0;
	let hi = starts.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((starts[mid] ?? 0) <= end) lo = mid + 1;
		else hi = mid;
	}
	const line = lo - 1;
	return { line, col: end - (starts[line] ?? 0) };
}
