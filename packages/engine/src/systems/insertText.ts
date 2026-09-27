export interface TextInsertion {
	text: string;
	/** Offset into `text` right after the inserted text — where the caret lands. */
	cursor: number;
}

/**
 * The bag-paste math: splice `insertText` into `doc` at `cursor`, caret ending
 * up right after what was just pasted. CodeMirror's own transaction does the
 * actual DOM/state splice (EditorOverlay applies this as a whole-document
 * change since files here are small enough that a minimal change range isn't
 * worth the extra bookkeeping) — this is the pure part worth testing without
 * spinning up a real editor view.
 */
export function insertTextAt(
	doc: string,
	cursor: number,
	insertText: string,
): TextInsertion {
	const clamped = Math.max(0, Math.min(cursor, doc.length));
	const text = doc.slice(0, clamped) + insertText + doc.slice(clamped);
	return { text, cursor: clamped + insertText.length };
}
