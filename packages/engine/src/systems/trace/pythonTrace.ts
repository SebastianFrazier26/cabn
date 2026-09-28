import { TRACE_DEPTH_CAP, TRACE_STEP_CAP, type TraceStep } from "./types.js";

interface FnDef {
	name: string;
	/** 0-indexed, first line of the body (may be past bodyEnd if the def has an empty/`pass`-only body followed immediately by a dedent). */
	bodyStart: number;
	/** 0-indexed, exclusive — first line at or below the def's own indent. */
	bodyEnd: number;
}

const DEF_HEADER_RE = /^def\s+([A-Za-z_]\w*)\s*\(/;
const CALL_RE = /^([A-Za-z_]\w*)\s*\(/;
const MAIN_GUARD_RE = /^if\s+__name__\s*==\s*['"]__main__['"]\s*:/;

function indentOf(line: string): number {
	let i = 0;
	while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
	return i;
}

function isBlankOrComment(line: string): boolean {
	const trimmed = line.trim();
	return trimmed === "" || trimmed.startsWith("#");
}

function isImportLine(trimmed: string): boolean {
	return /^(import\s|from\s)/.test(trimmed);
}

/** Only top-level (indent 0) defs are ever "locally-defined functions" a top-level call can step into — matching the milestone's own scope ("a top-level call to a locally-defined function"). */
function findTopLevelDefs(lines: string[]): Map<string, FnDef> {
	const defs = new Map<string, FnDef>();
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (indentOf(line) !== 0 || isBlankOrComment(line)) continue;
		const match = DEF_HEADER_RE.exec(line.trim());
		if (!match) continue;
		const name = match[1];
		if (!name) continue;

		let bodyEnd = i + 1;
		while (bodyEnd < lines.length) {
			const bodyLine = lines[bodyEnd] ?? "";
			if (isBlankOrComment(bodyLine)) {
				bodyEnd++;
				continue;
			}
			if (indentOf(bodyLine) > 0) {
				bodyEnd++;
				continue;
			}
			break;
		}
		defs.set(name, { name, bodyStart: i + 1, bodyEnd });
	}
	return defs;
}

/** Steps through one function's body, recursing into further top-level-defined calls up to TRACE_DEPTH_CAP. Nested `def` headers inside the body are reported (their own body is never walked at definition time, same as a top-level def). */
function stepIntoFunction(
	def: FnDef,
	depth: number,
	lines: string[],
	defs: Map<string, FnDef>,
	steps: TraceStep[],
): void {
	if (depth > TRACE_DEPTH_CAP) return;
	let i = def.bodyStart;
	while (i < def.bodyEnd && steps.length < TRACE_STEP_CAP) {
		const line = lines[i] ?? "";
		if (isBlankOrComment(line)) {
			i++;
			continue;
		}
		const trimmed = line.trim();

		const nestedDef = DEF_HEADER_RE.exec(trimmed);
		if (nestedDef?.[1]) {
			steps.push({ line: i + 1, kind: "def", note: `define ${nestedDef[1]}` });
			const nestedIndent = indentOf(line);
			i++;
			while (i < def.bodyEnd) {
				const next = lines[i] ?? "";
				if (isBlankOrComment(next)) {
					i++;
					continue;
				}
				if (indentOf(next) > nestedIndent) {
					i++;
					continue;
				}
				break;
			}
			continue;
		}

		if (isImportLine(trimmed)) {
			steps.push({ line: i + 1, kind: "import" });
			i++;
			continue;
		}

		const call = CALL_RE.exec(trimmed);
		const target = call?.[1] ? defs.get(call[1]) : undefined;
		if (call && target) {
			steps.push({ line: i + 1, kind: "call", note: `call ${call[1]}` });
			stepIntoFunction(target, depth + 1, lines, defs, steps);
			i++;
			continue;
		}

		if (/^return\b/.test(trimmed)) {
			steps.push({ line: i + 1, kind: "return" });
			i++;
			continue;
		}

		steps.push({ line: i + 1, kind: "stmt" });
		i++;
	}
}

/** Walks the `if __name__ == "__main__":` guard's own body inline (it's not a def, so it has no `FnDef` entry to step into) — same per-line classification as a function body, just scoped by indent instead of a precomputed range. Returns the index just past the block. */
function walkGuardBlock(
	lines: string[],
	start: number,
	guardIndent: number,
	defs: Map<string, FnDef>,
	steps: TraceStep[],
): number {
	let i = start;
	while (i < lines.length && steps.length < TRACE_STEP_CAP) {
		const line = lines[i] ?? "";
		if (isBlankOrComment(line)) {
			i++;
			continue;
		}
		if (indentOf(line) <= guardIndent) break;
		const trimmed = line.trim();

		if (isImportLine(trimmed)) {
			steps.push({ line: i + 1, kind: "import" });
			i++;
			continue;
		}
		const call = CALL_RE.exec(trimmed);
		const target = call?.[1] ? defs.get(call[1]) : undefined;
		if (call && target) {
			steps.push({ line: i + 1, kind: "call", note: `call ${call[1]}` });
			stepIntoFunction(target, 1, lines, defs, steps);
			i++;
			continue;
		}
		if (/^return\b/.test(trimmed)) {
			steps.push({ line: i + 1, kind: "return" });
			i++;
			continue;
		}
		steps.push({ line: i + 1, kind: "stmt" });
		i++;
	}
	return i;
}

export function buildPythonTrace(lines: string[]): TraceStep[] {
	const defs = findTopLevelDefs(lines);
	const steps: TraceStep[] = [];
	let i = 0;
	while (i < lines.length && steps.length < TRACE_STEP_CAP) {
		const line = lines[i] ?? "";
		if (isBlankOrComment(line) || indentOf(line) !== 0) {
			i++;
			continue;
		}
		const trimmed = line.trim();

		const defMatch = DEF_HEADER_RE.exec(trimmed);
		if (defMatch?.[1]) {
			steps.push({ line: i + 1, kind: "def", note: `define ${defMatch[1]}` });
			i = defs.get(defMatch[1])?.bodyEnd ?? i + 1;
			continue;
		}

		if (isImportLine(trimmed)) {
			steps.push({ line: i + 1, kind: "import" });
			i++;
			continue;
		}

		if (MAIN_GUARD_RE.test(trimmed)) {
			steps.push({ line: i + 1, kind: "stmt", note: "entry point guard" });
			i = walkGuardBlock(lines, i + 1, indentOf(line), defs, steps);
			continue;
		}

		const call = CALL_RE.exec(trimmed);
		const target = call?.[1] ? defs.get(call[1]) : undefined;
		if (call && target) {
			steps.push({ line: i + 1, kind: "call", note: `call ${call[1]}` });
			stepIntoFunction(target, 1, lines, defs, steps);
			i++;
			continue;
		}

		if (/^return\b/.test(trimmed)) {
			steps.push({ line: i + 1, kind: "return" });
			i++;
			continue;
		}

		steps.push({ line: i + 1, kind: "stmt" });
		i++;
	}
	return steps;
}
