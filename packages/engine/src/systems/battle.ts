import {
	type Annotator,
	bracketBalance,
	brokenImport,
	checkExternalFindingFixed,
	codeSmell,
	deadCode,
	type ErrorAnnotation,
	EXTERNAL_RULE_PREFIX,
	encodingIssue,
	extractRelativeRefs,
	leakedSecret,
	parseFailure,
	resolveRelativeRefTarget,
	smellOptionsFromRule,
	syntaxError,
	todoMarker,
} from "@cabn/converter/browser";
import type { ErrorCode, PortalFile } from "@cabn/world-schema";

/**
 * Per-file re-check only — OuroborosError doesn't fit this shape (see
 * `checkMonsterFixed` below) and is handled separately, not listed here.
 */
const PER_FILE_ANNOTATOR_BY_CODE: Partial<Record<ErrorCode, Annotator>> = {
	NullTypeError: brokenImport,
	Corrupted: parseFailure,
	IoError: bracketBalance,
	InvalidMode: encodingIssue,
	WispNote: todoMarker,
	SyntaxError: syntaxError,
	LeakedSecret: leakedSecret,
	DeadCode: deadCode,
	CodeSmell: codeSmell,
};

const CIRCULAR_IMPORT_RULE_PREFIX = "circular-import:";

export interface BattleMonster {
	code: ErrorCode;
	rule: string;
}

/**
 * True if editing this file resolved the specific bug `monster` represents —
 * re-runs the same annotator that originally found it and checks whether its
 * exact `rule` string still shows up (not just "any annotation of this
 * species is gone": a file can have more than one bug of the same species,
 * and only the encountered one should count).
 *
 * OuroborosError only ever reaches an encounter when it's portal-attached
 * (an intra-cluster cycle — see run.ts's attachCycle and WorldScene's
 * "path-attached ouroboros is cosmetic-only" scope cut in the M6 CHANGELOG),
 * which means the monster's own portal is one file *in* the cycle. Fixing it
 * only ever requires removing that file's own import edge into the rest of
 * the recorded cycle (parsed back out of the rule string) — never another
 * file's content — so this stays a pure, single-file check like every other
 * code, at the cost of not re-verifying the cycle is *globally* gone (a
 * false "still broken" is impossible; a false "fixed" would require the
 * player having re-created an equivalent cycle through a different file in
 * the same edit, which the quill can't do — it only ever touches one file).
 */
export function checkMonsterFixed(
	monster: BattleMonster,
	file: PortalFile,
	content: string,
	worldFiles: ReadonlySet<string>,
): boolean {
	// External-tool findings (any code, including UnknownBug) can't be re-run
	// in the browser; they die when the line they flagged changes.
	if (monster.rule.startsWith(EXTERNAL_RULE_PREFIX)) {
		return checkExternalFindingFixed(monster.rule, content);
	}
	if (monster.code === "OuroborosError") {
		if (!monster.rule.startsWith(CIRCULAR_IMPORT_RULE_PREFIX)) return true;
		const members = new Set(
			monster.rule.slice(CIRCULAR_IMPORT_RULE_PREFIX.length).split(","),
		);
		for (const ref of extractRelativeRefs(file.path, content)) {
			if (ref.isMarkdownLink) continue;
			const candidates = resolveRelativeRefTarget(file.path, ref);
			if (candidates.some((c) => members.has(c))) return false;
		}
		return true;
	}

	const annotator = PER_FILE_ANNOTATOR_BY_CODE[monster.code];
	if (!annotator) return true; // no re-check for an unrecognized code — never leaves the player permanently stuck
	// A CodeSmell rule carries the threshold it was judged by (a world's
	// cabn.json may have changed the default), so re-judge with that one.
	const options =
		monster.code === "CodeSmell"
			? smellOptionsFromRule(monster.rule)
			: undefined;
	const results = annotator({ file, content, worldFiles, options });
	return !results.some((r) => r.rule === monster.rule);
}

/**
 * Every per-file annotator's live read of the buffer currently open in the
 * quill — the spellbook's right page (SpellbookOverlay) uses this to list
 * "current file's monster/annotator errors" without waiting for a save, by
 * running the same pure per-file annotators `checkMonsterFixed` re-checks
 * against, rather than reaching into WorldScene's `MonsterSummary[]` (which
 * only ever holds *spawned* monsters at their last-saved content, and has no
 * line data — see bridge/store.ts). circularImport/OuroborosError is
 * deliberately excluded, same scope cut as `checkMonsterFixed` above: it's a
 * multi-file cycle check that needs the whole world's import graph, not a
 * single buffer.
 */
export function annotateFileLive(
	file: PortalFile,
	content: string,
	worldFiles: ReadonlySet<string>,
): ErrorAnnotation[] {
	const seen = new Set<Annotator>();
	const results: ErrorAnnotation[] = [];
	for (const annotator of Object.values(PER_FILE_ANNOTATOR_BY_CODE)) {
		if (!annotator || seen.has(annotator)) continue; // a couple of codes above share the same annotator function
		seen.add(annotator);
		results.push(...annotator({ file, content, worldFiles }));
	}
	return results;
}
