import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	type CaretLayout,
	columnFromDisplay,
	columnFromPaintedSpans,
	deletionRange,
	displayColumn,
	moveCaret,
	pointFromPos,
	posFromPoint,
	wordRangeAt,
} from "../src/systems/caretMotion.js";

const doc = (s: string) => Text.of(s.split("\n"));
const at = (pos: number) => ({ anchor: pos, head: pos });
const layout: CaretLayout = { lineHeight: 20, textX: 64, charWidth: 8 };

describe("displayColumn / columnFromDisplay", () => {
	it("expands tabs to four cells", () => {
		expect(displayColumn("\tab", 1)).toBe(4);
		expect(displayColumn("\tab", 3)).toBe(6);
		expect(displayColumn("abc", 99)).toBe(3);
	});

	it("rounds to the nearest character boundary", () => {
		expect(columnFromDisplay("abcdef", 2.4)).toBe(2);
		expect(columnFromDisplay("abcdef", 2.6)).toBe(3);
		expect(columnFromDisplay("abc", 40)).toBe(3);
		expect(columnFromDisplay("abc", -3)).toBe(0);
	});

	it("treats a tab as one wide cell", () => {
		expect(columnFromDisplay("\tx", 1.9)).toBe(0);
		expect(columnFromDisplay("\tx", 2.1)).toBe(1);
		expect(columnFromDisplay("\tx", 4.4)).toBe(1);
	});

	it("never lands inside a surrogate pair", () => {
		const text = "a😀b";
		expect(displayColumn(text, 3)).toBe(2);
		expect(columnFromDisplay(text, 1.6)).toBe(3);
	});
});

describe("posFromPoint / pointFromPos", () => {
	const d = doc("hello\n\tworld\nx");

	it("maps a click to the line row and nearest column", () => {
		expect(posFromPoint(d, { x: 64 + 8 * 2.2, y: 3 }, layout)).toBe(2);
		// Line 1 spans y 10..30 (centred on 20).
		expect(posFromPoint(d, { x: 64 + 8 * 5, y: 12 }, layout)).toBe(6 + 2);
	});

	it("clamps left of the text to column 0 and past the end to line end", () => {
		expect(posFromPoint(d, { x: -50, y: 20 }, layout)).toBe(6);
		expect(posFromPoint(d, { x: 900, y: 0 }, layout)).toBe(5);
	});

	it("puts a click above the page on line 1 and below it at the doc end", () => {
		expect(posFromPoint(d, { x: 64, y: -80 }, layout)).toBe(0);
		expect(posFromPoint(d, { x: 64, y: 400 }, layout)).toBe(d.length);
	});

	it("round-trips through pointFromPos", () => {
		for (const pos of [0, 3, 5, 6, 7, 12, 13, 14]) {
			const p = pointFromPos(d, pos, layout);
			expect(posFromPoint(d, p, layout)).toBe(pos);
		}
		expect(pointFromPos(d, 7, layout)).toEqual({
			x: 64 + 4 * 8,
			y: 20,
			line: 1,
			column: 1,
		});
	});
});

describe("moveCaret", () => {
	const d = doc("function foo(bar) {\n  return bar;\n}\n\nlong line here");

	it("moves by character across line breaks", () => {
		expect(moveCaret(d, at(19), "charRight", { extend: false }).range).toEqual(
			at(20),
		);
		expect(moveCaret(d, at(20), "charLeft", { extend: false }).range).toEqual(
			at(19),
		);
		expect(moveCaret(d, at(0), "charLeft", { extend: false }).range).toEqual(
			at(0),
		);
		expect(
			moveCaret(d, at(d.length), "charRight", { extend: false }).range,
		).toEqual(at(d.length));
	});

	it("collapses a selection to its near edge instead of stepping", () => {
		const sel = { anchor: 3, head: 9 };
		expect(moveCaret(d, sel, "charLeft", { extend: false }).range).toEqual(
			at(3),
		);
		expect(moveCaret(d, sel, "charRight", { extend: false }).range).toEqual(
			at(9),
		);
	});

	it("extends from the anchor with shift", () => {
		const r = moveCaret(d, at(3), "charRight", { extend: true }).range;
		expect(r).toEqual({ anchor: 3, head: 4 });
		const r2 = moveCaret(d, r, "lineDown", { extend: true }).range;
		expect(r2.anchor).toBe(3);
		expect(r2.head).toBe(20 + 4);
	});

	it("holds the goal column through a short line", () => {
		const start = d.line(5).from + 10; // "long line |here"
		const up = moveCaret(d, at(start), "lineUp", { extend: false });
		expect(up.range.head).toBe(d.line(4).from); // empty line
		expect(up.goalColumn).toBe(10);
		const up2 = moveCaret(d, up.range, "lineUp", {
			extend: false,
			goalColumn: up.goalColumn,
		});
		expect(up2.range.head).toBe(d.line(3).from + 1); // "}" is short
		const down = moveCaret(d, up2.range, "lineDown", {
			extend: false,
			goalColumn: up2.goalColumn,
		});
		const down2 = moveCaret(d, down.range, "lineDown", {
			extend: false,
			goalColumn: down.goalColumn,
		});
		expect(down2.range.head).toBe(start);
	});

	it("goes to line start/end on the first/last line's vertical edge", () => {
		expect(moveCaret(d, at(5), "lineUp", { extend: false }).range).toEqual(
			at(0),
		);
		expect(
			moveCaret(d, at(d.line(5).from + 2), "lineDown", { extend: false }).range,
		).toEqual(at(d.length));
	});

	it("toggles Home between the indent and column 0", () => {
		const line2 = d.line(2);
		const mid = line2.from + 6;
		const first = moveCaret(d, at(mid), "lineStart", { extend: false });
		expect(first.range.head).toBe(line2.from + 2);
		const second = moveCaret(d, first.range, "lineStart", { extend: false });
		expect(second.range.head).toBe(line2.from);
		expect(moveCaret(d, at(mid), "lineEnd", { extend: false }).range.head).toBe(
			line2.to,
		);
	});

	it("jumps by word and punctuation groups", () => {
		let r = at(0);
		const stops: number[] = [];
		for (let i = 0; i < 5; i++) {
			r = moveCaret(d, r, "wordRight", { extend: false }).range;
			stops.push(r.head);
		}
		// function| foo|(|bar|) {  -> ")" and "{" are separate punct runs split by space
		expect(stops).toEqual([8, 12, 13, 16, 17]);
		const back = moveCaret(d, at(16), "wordLeft", { extend: false }).range;
		expect(back.head).toBe(13);
		expect(
			moveCaret(d, at(d.line(2).from), "wordLeft", { extend: false }).range
				.head,
		).toBe(d.line(1).to);
	});

	it("pages by the given number of lines and reaches the doc edges", () => {
		expect(
			moveCaret(d, at(0), "pageDown", { extend: false, pageLines: 2 }).range
				.head,
		).toBe(d.line(3).from);
		expect(moveCaret(d, at(30), "docStart", { extend: false }).range).toEqual(
			at(0),
		);
		expect(moveCaret(d, at(3), "docEnd", { extend: false }).range).toEqual(
			at(d.length),
		);
	});
});

describe("deletionRange", () => {
	const d = doc("abc def\nxyz");

	it("removes the selection when there is one", () => {
		expect(deletionRange(d, { anchor: 5, head: 1 }, "charLeft")).toEqual({
			from: 1,
			to: 5,
		});
	});

	it("backspaces a character, a newline, or nothing at the start", () => {
		expect(deletionRange(d, at(2), "charLeft")).toEqual({ from: 1, to: 2 });
		expect(deletionRange(d, at(8), "charLeft")).toEqual({ from: 7, to: 8 });
		expect(deletionRange(d, at(0), "charLeft")).toBeNull();
		expect(deletionRange(d, at(d.length), "charRight")).toBeNull();
	});

	it("deletes by word and to the line start", () => {
		expect(deletionRange(d, at(7), "wordLeft")).toEqual({ from: 4, to: 7 });
		expect(deletionRange(d, at(0), "wordRight")).toEqual({ from: 0, to: 3 });
		expect(deletionRange(d, at(6), "lineStart")).toEqual({ from: 0, to: 6 });
		expect(deletionRange(d, at(8), "lineStart")).toEqual({ from: 7, to: 8 });
		expect(deletionRange(d, at(1), "lineEnd")).toEqual({ from: 1, to: 7 });
	});
});

describe("wordRangeAt", () => {
	it("selects the word, punctuation run or nothing under a position", () => {
		const d = doc("let fooBar = a+=b;");
		expect(wordRangeAt(d, 5)).toEqual({ from: 4, to: 10 });
		expect(wordRangeAt(d, 10)).toEqual({ from: 10, to: 11 });
		expect(wordRangeAt(d, 15)).toEqual({ from: 14, to: 16 });
		expect(wordRangeAt(doc(""), 0)).toEqual({ from: 0, to: 0 });
	});
});

describe("columnFromPaintedSpans", () => {
	// "`HarvestRecord` is the one": code span painted from x=64, then plain.
	const line = "`HarvestRecord` is the one";
	const spans = [
		{ x: 64, width: 13 * 8, from: 1, to: 14 },
		{ x: 64 + 13 * 8, width: 11 * 8, from: 15, to: 26 },
	];

	it("maps a click on painted text to the source column under it, past hidden markup", () => {
		// The "i" of "is" is painted 14 glyphs in; in source it's column 16.
		expect(
			columnFromPaintedSpans(spans, 64 + 14 * 8 + 2, 64, line.length),
		).toBe(16);
		expect(columnFromPaintedSpans(spans, 64 + 2, 64, line.length)).toBe(1);
		// Right half of a glyph rounds to the boundary after it.
		expect(columnFromPaintedSpans(spans, 64 + 5, 64, line.length)).toBe(2);
	});

	it("uses each span's own glyph width (a wider heading font)", () => {
		const heading = [{ x: 64, width: 6 * 12, from: 3, to: 9 }]; // "## Fields"
		expect(columnFromPaintedSpans(heading, 64 + 3 * 12 + 1, 64, 9)).toBe(6);
	});

	it("clamps outside the painted text: left of the text column is 0, past the end is the line end", () => {
		expect(columnFromPaintedSpans(spans, 10, 64, line.length)).toBe(0);
		expect(columnFromPaintedSpans(spans, 999, 64, line.length)).toBe(
			line.length,
		);
		// Between the text column and the first span (a list bullet): the first painted char.
		const list = [{ x: 78, width: 40, from: 2, to: 7 }];
		expect(columnFromPaintedSpans(list, 70, 64, 7)).toBe(2);
		expect(columnFromPaintedSpans([], 100, 64, 0)).toBe(0);
	});
});
