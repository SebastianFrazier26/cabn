import type { ErrorAnnotation } from "@cabn/converter/core";
import type { RunStatus } from "./runPlayback.js";

/** The spellbook's own inline run never reaches "blocked" (that's FileScene's
 * world-run pausing on a monster standing on the line — see EditorOverlay.tsx's
 * doc comment on why the two runs are separate) but "idle" (no run started
 * this session) is a state RunStatus itself has no member for. */
export type SpellbookRunStatus = RunStatus | "idle";

export interface SpellbookStatusInput {
	dirty: boolean;
	runStatus: SpellbookRunStatus;
	errorCount: number;
}

export interface SpellbookStatusLine {
	saveLabel: "saved" | "unsaved";
	runStatus: SpellbookRunStatus;
	errorCount: number;
	/** The one-line status bar string EditorOverlay renders verbatim. */
	summary: string;
}

const RUN_STATUS_LABEL: Record<SpellbookRunStatus, string> = {
	idle: "not run",
	playing: "running",
	paused: "paused",
	blocked: "blocked",
	done: "finished",
};

/** Pure so the status bar's exact wording is unit-testable without mounting
 * the editor — see tests/spellbookStatus.test.ts. */
export function spellbookStatusLine(
	input: SpellbookStatusInput,
): SpellbookStatusLine {
	const saveLabel = input.dirty ? "unsaved" : "saved";
	const errorPart =
		input.errorCount === 0
			? "no errors"
			: input.errorCount === 1
				? "1 error"
				: `${input.errorCount} errors`;
	return {
		saveLabel,
		runStatus: input.runStatus,
		errorCount: input.errorCount,
		summary: `${saveLabel} · ${RUN_STATUS_LABEL[input.runStatus]} · ${errorPart}`,
	};
}

export interface SpellbookErrorRow {
	/** Stable across re-renders for a fixed annotation set (code+rule+loc), not array index — the list re-sorts by line on every keystroke. */
	key: string;
	/** 1-based for display (editors count from 1); null when the annotation carries no location (rare — see ErrorAnnotation.loc's own doc comment). */
	displayLine: number | null;
	/** 0-based, matching EditorOverlay's editorInitialLine/CodeMirror doc.line() convention — undefined alongside a null displayLine. */
	line: number | undefined;
	message: string;
	species: string;
}

/** Maps live-annotator output (systems/battle.ts's annotateFileLive) into the
 * right page's clickable row list, sorted by line so it reads top-to-bottom
 * like the file itself — annotators don't run in line order (each is a
 * separate independent pass). */
export function toSpellbookErrorRows(
	annotations: readonly ErrorAnnotation[],
): SpellbookErrorRow[] {
	return annotations
		.map((a, index) => ({
			key: `${a.code}:${a.rule}:${index}`,
			displayLine: a.loc ? a.loc.line + 1 : null,
			line: a.loc?.line,
			message: a.message,
			species: a.species,
		}))
		.sort((a, b) => {
			if (a.line === undefined && b.line === undefined) return 0;
			if (a.line === undefined) return 1; // no-location rows sink to the bottom
			if (b.line === undefined) return -1;
			return a.line - b.line;
		});
}
