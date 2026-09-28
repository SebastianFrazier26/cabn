import { TRACE_STEP_CAP, type TraceStep } from "./types.js";

/**
 * Fallback for any language without a dedicated heuristic below: a straight
 * top-to-bottom walk over non-blank, non-comment lines, everything tagged
 * "stmt" — no import/def/call structure to lean on without per-language
 * syntax knowledge. `#`/`//` cover the line-comment syntax of most
 * mainstream languages this repo's classify.ts recognizes (shell, ruby,
 * rust, go, c-family, ...); a language using neither just traces every
 * non-blank line, which is still a reasonable "watch it run top to bottom"
 * experience.
 */
export function buildGenericTrace(lines: string[]): TraceStep[] {
	const steps: TraceStep[] = [];
	for (let i = 0; i < lines.length && steps.length < TRACE_STEP_CAP; i++) {
		const trimmed = lines[i]?.trim() ?? "";
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) {
			continue;
		}
		steps.push({ line: i + 1, kind: "stmt" });
	}
	return steps;
}
