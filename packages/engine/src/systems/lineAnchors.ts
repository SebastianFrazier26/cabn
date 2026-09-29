import {
	ChangeSet,
	StateEffect,
	StateField,
	type Text,
} from "@codemirror/state";
import { minimalChange } from "../pets/diff.js";

/**
 * Where each line's content sits after `changes`, as a 0-based line number
 * in `newDoc`. A line is anchored at its start with forward association, so
 * a newline typed at column 0 carries it down with its code, a newline at
 * the end of the line above pushes it down, a merge into the line above
 * pulls it up, and deleting the whole line collapses it onto the deletion
 * point.
 */
export function lineMapper(
	startDoc: Text,
	newDoc: Text,
	changes: ChangeSet,
): (line: number) => number {
	const effective = effectiveChanges(startDoc, newDoc, changes);
	return (line) =>
		newDoc.lineAt(effective.mapPos(lineStart(startDoc, line), 1)).number - 1;
}

function lineStart(doc: Text, line: number): number {
	const number = Math.min(Math.max(line + 1, 1), doc.lines);
	return doc.line(number).from;
}

/**
 * A transaction that swaps the whole document (the spyglass reset, a bag
 * paste in the spellbook, `setActivePortalContent`) would map every anchor to
 * one end — so it's re-expressed as the minimal prefix/suffix change first,
 * which keeps anchors outside the edited region on their code.
 */
function effectiveChanges(
	startDoc: Text,
	newDoc: Text,
	changes: ChangeSet,
): ChangeSet {
	if (startDoc.length === 0) return changes;
	let wholeDoc = false;
	changes.iterChangedRanges((fromA, toA) => {
		if (fromA === 0 && toA === startDoc.length) wholeDoc = true;
	});
	if (!wholeDoc) return changes;
	return ChangeSet.of(
		minimalChange(startDoc.toString(), newDoc.toString()),
		startDoc.length,
	);
}

export interface MonsterLine {
	id: string;
	/** 0-based line in the document the anchors are set against. */
	line: number;
}

/** Replaces the file buffer's monster anchors — FileScene sets them once per visit from the monsters' annotated lines. */
export const setMonsterAnchors = StateEffect.define<readonly MonsterLine[]>();

/**
 * Monster id -> document offset of its line's start, carried through every
 * transaction on the shared file buffer (systems/fileBuffer.ts). Living in
 * the EditorState rather than in FileScene is what makes it hold for both
 * editors: the file view's caret and the spellbook dispatch to the same
 * state, and the spellbook's compartment reconfigure keeps state fields.
 * Undo is just another change set, so undoing an edit maps monsters back.
 */
export const monsterAnchors = StateField.define<ReadonlyMap<string, number>>({
	create: () => new Map(),
	update(anchors, tr) {
		let next = anchors;
		if (tr.docChanged && anchors.size > 0) {
			const changes = effectiveChanges(
				tr.startState.doc,
				tr.newDoc,
				tr.changes,
			);
			const mapped = new Map<string, number>();
			for (const [id, pos] of anchors) mapped.set(id, changes.mapPos(pos, 1));
			next = mapped;
		}
		for (const effect of tr.effects) {
			if (!effect.is(setMonsterAnchors)) continue;
			const set = new Map<string, number>();
			for (const { id, line } of effect.value) {
				set.set(id, lineStart(tr.newDoc, line));
			}
			next = set;
		}
		return next;
	},
});

/** A monster's current 0-based line in `doc`, or undefined if it was never anchored. */
export function anchoredLine(
	anchors: ReadonlyMap<string, number> | undefined,
	doc: Text,
	id: string,
): number | undefined {
	const pos = anchors?.get(id);
	if (pos === undefined) return undefined;
	return doc.lineAt(Math.min(pos, doc.length)).number - 1;
}
