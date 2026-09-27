/**
 * Converts a character offset into a 0-based {line, col} — the convention
 * every annotator and the engine's line arrays share (see types.ts). Linear
 * in `index`, which is fine at the file sizes annotators ever see (walk.ts's
 * own maxFileBytes cap keeps content well under a size where this matters).
 */
export function locAt(
	content: string,
	index: number,
): { line: number; col: number } {
	let line = 0;
	let col = 0;
	const end = Math.min(index, content.length);
	for (let i = 0; i < end; i++) {
		if (content[i] === "\n") {
			line++;
			col = 0;
		} else {
			col++;
		}
	}
	return { line, col };
}
