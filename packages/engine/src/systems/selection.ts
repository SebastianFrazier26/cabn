/**
 * FileScene's bag-tool selection state: an anchor line plus a focus line that
 * shift+arrow moves — "current line ± extend", the simplest range model that
 * still lets a selection grow in either direction from where it started.
 */
export interface LineSelection {
	anchor: number;
	focus: number;
}

export function startSelection(currentLine: number): LineSelection {
	return { anchor: currentLine, focus: currentLine };
}

export function extendSelection(
	selection: LineSelection,
	delta: number,
	totalLines: number,
): LineSelection {
	const maxLine = Math.max(0, totalLines - 1);
	const focus = Math.min(Math.max(selection.focus + delta, 0), maxLine);
	return { ...selection, focus };
}

export interface LineRange {
	start: number;
	end: number;
}

/** Normalizes anchor/focus (either can be the smaller one) into start <= end. */
export function selectionRange(selection: LineSelection): LineRange {
	return selection.anchor <= selection.focus
		? { start: selection.anchor, end: selection.focus }
		: { start: selection.focus, end: selection.anchor };
}
