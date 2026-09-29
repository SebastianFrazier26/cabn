import { redo, undo } from "@codemirror/commands";
import {
	EditorSelection,
	type EditorState,
	type StateCommand,
	Transaction,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	createFileBufferState,
	spellbookCompartment,
} from "../src/systems/fileBuffer.js";
import {
	anchoredLine,
	lineMapper,
	monsterAnchors,
	setMonsterAnchors,
} from "../src/systems/lineAnchors.js";

const SRC = ["line0", "line1", "bad(,)", "line3", "worse;;"].join("\n");

function withMonsters(): EditorState {
	return createFileBufferState(SRC).update({
		effects: setMonsterAnchors.of([
			{ id: "a", line: 2 },
			{ id: "b", line: 4 },
		]),
		annotations: Transaction.addToHistory.of(false),
	}).state;
}

function lines(state: EditorState): Record<string, number | undefined> {
	const anchors = state.field(monsterAnchors);
	return {
		a: anchoredLine(anchors, state.doc, "a"),
		b: anchoredLine(anchors, state.doc, "b"),
	};
}

function lineFrom(state: EditorState, line: number): number {
	return state.doc.line(line + 1).from;
}

function run(state: EditorState, command: StateCommand): EditorState {
	let next = state;
	command({
		state,
		dispatch: (tr) => {
			next = tr.state;
		},
	});
	return next;
}

describe("monsterAnchors", () => {
	it("starts on the monsters' annotated lines", () => {
		expect(lines(withMonsters())).toEqual({ a: 2, b: 4 });
	});

	it("shifts down when lines are inserted above", () => {
		const s = withMonsters().update({
			changes: { from: 0, insert: "x\ny\n" },
		}).state;
		expect(lines(s)).toEqual({ a: 4, b: 6 });
	});

	it("shifts up when lines are deleted above", () => {
		const s0 = withMonsters();
		const s = s0.update({ changes: { from: 0, to: lineFrom(s0, 2) } }).state;
		expect(lines(s)).toEqual({ a: 0, b: 2 });
	});

	it("moves with its code when a newline is typed at column 0 of its line", () => {
		const s0 = withMonsters();
		const s = s0.update({
			changes: { from: lineFrom(s0, 2), insert: "\n" },
		}).state;
		expect(lines(s)).toEqual({ a: 3, b: 5 });
	});

	it("stays put for a newline at the end of its own line or mid-line", () => {
		const s0 = withMonsters();
		const end = s0.doc.line(3).to;
		const s = s0.update({ changes: { from: end, insert: "\n" } }).state;
		expect(lines(s)).toEqual({ a: 2, b: 5 });
		const mid = s0.update({
			changes: { from: lineFrom(s0, 2) + 3, insert: "\n" },
		}).state;
		expect(lines(mid)).toEqual({ a: 2, b: 5 });
	});

	it("follows its line when it's merged into the line above", () => {
		const s0 = withMonsters();
		const from = lineFrom(s0, 2);
		const s = s0.update({ changes: { from: from - 1, to: from } }).state;
		expect(lines(s)).toEqual({ a: 1, b: 3 });
	});

	it("maps back through undo and forward again through redo", () => {
		let s = withMonsters().update({
			changes: { from: 0, insert: "\n\n" },
			selection: EditorSelection.cursor(2),
			userEvent: "input",
		}).state;
		expect(lines(s)).toEqual({ a: 4, b: 6 });
		s = run(s, undo);
		expect(lines(s)).toEqual({ a: 2, b: 4 });
		s = run(s, redo);
		expect(lines(s)).toEqual({ a: 4, b: 6 });
	});

	it("setting the anchors isn't an undo step", () => {
		expect(lines(run(withMonsters(), undo))).toEqual({ a: 2, b: 4 });
	});

	it("keeps code outside the edit on its lines when the whole doc is replaced", () => {
		const s0 = withMonsters();
		const text = s0.doc.toString().replace("line1", "line1\nnew");
		const s = s0.update({
			changes: { from: 0, to: s0.doc.length, insert: text },
		}).state;
		expect(lines(s)).toEqual({ a: 3, b: 5 });
	});

	it("survives the spellbook's compartment reconfigure", () => {
		const s = withMonsters()
			.update({ changes: { from: 0, insert: "\n" } })
			.state.update({ effects: spellbookCompartment.reconfigure([]) }).state;
		expect(lines(s)).toEqual({ a: 3, b: 5 });
	});

	it("is undefined for a monster that was never anchored", () => {
		const s = withMonsters();
		expect(anchoredLine(s.field(monsterAnchors), s.doc, "zzz")).toBeUndefined();
	});
});

describe("lineMapper", () => {
	it("maps many lines through one transaction's changes", () => {
		const s0 = createFileBufferState(SRC);
		const tr = s0.update({
			changes: { from: lineFrom(s0, 1), insert: "a\nb\n" },
		});
		const map = lineMapper(tr.startState.doc, tr.newDoc, tr.changes);
		expect([0, 1, 2, 4].map(map)).toEqual([0, 3, 4, 6]);
	});

	it("collapses a deleted line onto the deletion point", () => {
		const s0 = createFileBufferState(SRC);
		const tr = s0.update({
			changes: { from: lineFrom(s0, 2), to: lineFrom(s0, 3) },
		});
		const map = lineMapper(tr.startState.doc, tr.newDoc, tr.changes);
		expect([2, 3, 4].map(map)).toEqual([2, 2, 3]);
	});
});
