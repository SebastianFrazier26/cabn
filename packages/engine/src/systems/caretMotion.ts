import { findClusterBreak, type Text } from "@codemirror/state";

/** Same fixed expansion FileScene has always drawn tabs with (each `\t` -> four spaces, not tab stops), so caret columns land on what is actually painted. */
export const TAB_DISPLAY_WIDTH = 4;

export interface CaretRange {
	anchor: number;
	head: number;
}

export type CaretMotion =
	| "charLeft"
	| "charRight"
	| "lineUp"
	| "lineDown"
	| "lineStart"
	| "lineEnd"
	| "wordLeft"
	| "wordRight"
	| "docStart"
	| "docEnd"
	| "pageUp"
	| "pageDown";

export interface MoveOptions {
	extend: boolean;
	/** Display column a run of vertical moves is trying to hold (so moving down through a short line and on to a long one returns to the original column). */
	goalColumn?: number;
	pageLines?: number;
}

export interface MoveResult {
	range: CaretRange;
	goalColumn: number | undefined;
}

function cellWidth(ch: string): number {
	return ch === "\t" ? TAB_DISPLAY_WIDTH : 1;
}

/** Painted cells from the start of `text` to character offset `col`, one cell per grapheme cluster. */
export function displayColumn(text: string, col: number): number {
	const end = Math.min(Math.max(col, 0), text.length);
	let cells = 0;
	let i = 0;
	while (i < end) {
		const next = findClusterBreak(text, i, true);
		cells += cellWidth(text[i] ?? "");
		i = next;
	}
	return cells;
}

/** Inverse of displayColumn: the cluster boundary nearest to `cells` painted cells in. */
export function columnFromDisplay(text: string, cells: number): number {
	if (cells <= 0) return 0;
	let acc = 0;
	let i = 0;
	while (i < text.length) {
		const w = cellWidth(text[i] ?? "");
		if (cells < acc + w / 2) return i;
		acc += w;
		i = findClusterBreak(text, i, true);
	}
	return text.length;
}

type CharClass = "space" | "word" | "punct";

function classify(ch: string): CharClass {
	if (/\s/.test(ch)) return "space";
	if (/[\p{L}\p{N}_$]/u.test(ch)) return "word";
	return "punct";
}

function wordStep(doc: Text, pos: number, forward: boolean): number {
	const line = doc.lineAt(pos);
	const edge = forward ? line.to : line.from;
	if (pos === edge) {
		if (forward) return line.number < doc.lines ? pos + 1 : pos;
		return line.number > 1 ? pos - 1 : pos;
	}
	const text = line.text;
	let i = pos - line.from;
	const at = (k: number) => text[forward ? k : k - 1] ?? "";
	const inBounds = (k: number) => (forward ? k < text.length : k > 0);
	while (inBounds(i) && classify(at(i)) === "space") i += forward ? 1 : -1;
	if (!inBounds(i)) return line.from + i;
	const cls = classify(at(i));
	while (inBounds(i) && classify(at(i)) === cls) i += forward ? 1 : -1;
	return line.from + i;
}

function verticalTarget(
	doc: Text,
	head: number,
	lines: number,
	goal: number,
): number {
	const line = doc.lineAt(head);
	const targetNumber = line.number + lines;
	if (targetNumber < 1) return 0;
	if (targetNumber > doc.lines) return doc.length;
	const target = doc.line(targetNumber);
	return target.from + columnFromDisplay(target.text, goal);
}

function smartLineStart(doc: Text, head: number): number {
	const line = doc.lineAt(head);
	const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
	return head - line.from === indent ? line.from : line.from + indent;
}

/**
 * One keyboard caret motion over a CodeMirror `Text`, pure so FileScene's
 * inline caret is unit-testable without Phaser. Behaves like a code editor:
 * a collapsing Left/Right lands on the selection's near edge, Up/Down hold a
 * goal column, Home toggles between the indent and column 0.
 */
export function moveCaret(
	doc: Text,
	range: CaretRange,
	motion: CaretMotion,
	options: MoveOptions,
): MoveResult {
	const { extend } = options;
	const from = Math.min(range.anchor, range.head);
	const to = Math.max(range.anchor, range.head);
	const collapse = !extend && from !== to;
	const head = range.head;
	const vertical =
		motion === "lineUp" ||
		motion === "lineDown" ||
		motion === "pageUp" ||
		motion === "pageDown";
	const goal = vertical
		? (options.goalColumn ??
			displayColumn(doc.lineAt(head).text, head - doc.lineAt(head).from))
		: undefined;

	let next: number;
	switch (motion) {
		case "charLeft": {
			if (collapse) {
				next = from;
				break;
			}
			const line = doc.lineAt(head);
			next =
				head === line.from
					? Math.max(head - 1, 0)
					: line.from + findClusterBreak(line.text, head - line.from, false);
			break;
		}
		case "charRight": {
			if (collapse) {
				next = to;
				break;
			}
			const line = doc.lineAt(head);
			next =
				head === line.to
					? Math.min(head + 1, doc.length)
					: line.from + findClusterBreak(line.text, head - line.from, true);
			break;
		}
		case "lineUp":
			next = verticalTarget(doc, head, -1, goal ?? 0);
			break;
		case "lineDown":
			next = verticalTarget(doc, head, 1, goal ?? 0);
			break;
		case "pageUp":
			next = verticalTarget(doc, head, -(options.pageLines ?? 20), goal ?? 0);
			break;
		case "pageDown":
			next = verticalTarget(doc, head, options.pageLines ?? 20, goal ?? 0);
			break;
		case "lineStart":
			next = smartLineStart(doc, head);
			break;
		case "lineEnd":
			next = doc.lineAt(head).to;
			break;
		case "wordLeft":
			next = wordStep(doc, head, false);
			break;
		case "wordRight":
			next = wordStep(doc, head, true);
			break;
		case "docStart":
			next = 0;
			break;
		case "docEnd":
			next = doc.length;
			break;
	}
	return {
		range: extend
			? { anchor: range.anchor, head: next }
			: { anchor: next, head: next },
		goalColumn: goal,
	};
}

export type DeleteMotion =
	| "charLeft"
	| "charRight"
	| "wordLeft"
	| "wordRight"
	| "lineStart"
	| "lineEnd";

/** What Backspace/Delete (and their word/line chords) remove: the selection if there is one, else from the caret to where `motion` would take it. Null when there's nothing to remove (Backspace at the very start). */
export function deletionRange(
	doc: Text,
	range: CaretRange,
	motion: DeleteMotion,
): { from: number; to: number } | null {
	if (range.anchor !== range.head) {
		return {
			from: Math.min(range.anchor, range.head),
			to: Math.max(range.anchor, range.head),
		};
	}
	const target =
		motion === "lineStart"
			? doc.lineAt(range.head).from === range.head
				? Math.max(range.head - 1, 0)
				: doc.lineAt(range.head).from
			: moveCaret(doc, range, motion, { extend: true }).range.head;
	if (target === range.head) return null;
	return {
		from: Math.min(target, range.head),
		to: Math.max(target, range.head),
	};
}

/** The word (or punctuation run) under `pos`, for double-click selection. */
export function wordRangeAt(
	doc: Text,
	pos: number,
): { from: number; to: number } {
	const line = doc.lineAt(pos);
	const text = line.text;
	const i = pos - line.from;
	const probe = text[i] ?? text[i - 1];
	if (probe === undefined) return { from: pos, to: pos };
	const cls = classify(probe);
	let start = text[i] !== undefined ? i : i - 1;
	let end = start + 1;
	while (start > 0 && classify(text[start - 1] ?? "") === cls) start--;
	while (end < text.length && classify(text[end] ?? "") === cls) end++;
	return { from: line.from + start, to: line.from + end };
}

export interface CaretLayout {
	lineHeight: number;
	/** World x of column 0. */
	textX: number;
	charWidth: number;
}

/**
 * FileScene world point -> document offset. Line `i` is drawn centred on
 * `y = i * lineHeight` (its text box spans half a line either side), so the
 * row boundary sits half a line above each line's y. Above the first line
 * clamps onto it; below the last line is the end of the document, like a
 * click in the empty space under a code editor's text.
 */
export function posFromPoint(
	doc: Text,
	point: { x: number; y: number },
	layout: CaretLayout,
): number {
	const row = Math.floor((point.y + layout.lineHeight / 2) / layout.lineHeight);
	if (row >= doc.lines) return doc.length;
	const line = doc.line(Math.max(row, 0) + 1);
	const cells = (point.x - layout.textX) / layout.charWidth;
	return line.from + columnFromDisplay(line.text, cells);
}

/** Document offset -> where FileScene paints the caret: x at the column's left edge, y at the line's centre. */
export function pointFromPos(
	doc: Text,
	pos: number,
	layout: CaretLayout,
): { x: number; y: number; line: number; column: number } {
	const line = doc.lineAt(Math.min(Math.max(pos, 0), doc.length));
	const column = pos - line.from;
	return {
		x: layout.textX + displayColumn(line.text, column) * layout.charWidth,
		y: (line.number - 1) * layout.lineHeight,
		line: line.number - 1,
		column,
	};
}

/** One run of painted text on an enchanted markdown line: where it was drawn and which source characters it shows. */
export interface PaintedSpan {
	x: number;
	width: number;
	/** Source offsets within the line, `to - from` characters painted across `width`. */
	from: number;
	to: number;
}

/**
 * The source column under world `x` on a line drawn as `spans` (enchanted
 * markdown), which can't use the raw monospace grid: headings are wider and
 * the markup (`## `, backticks, `**`, a list marker) isn't painted at all,
 * so the grid lands columns away from the glyph that was clicked. Every span
 * is one monospace font, so a glyph is `width / (to - from)` wide. Left of
 * the text column is column 0 like a raw line; right of the last span is the
 * line's end.
 */
export function columnFromPaintedSpans(
	spans: readonly PaintedSpan[],
	x: number,
	textX: number,
	lineLength: number,
): number {
	if (x < textX) return 0;
	const first = spans[0];
	if (!first || x <= first.x) return first?.from ?? 0;
	for (const span of spans) {
		if (x >= span.x + span.width) continue;
		const chars = span.to - span.from;
		if (chars <= 0) return span.from;
		const glyph = span.width / chars;
		const col = span.from + Math.round((x - span.x) / glyph);
		return Math.min(Math.max(col, span.from), span.to);
	}
	return lineLength;
}
