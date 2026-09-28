import { buildGenericTrace } from "./genericTrace.js";
import { buildJsTrace } from "./jsTrace.js";
import { buildPythonTrace } from "./pythonTrace.js";
import type { TraceStep } from "./types.js";

export type { TraceStep } from "./types.js";
export { TRACE_DEPTH_CAP, TRACE_STEP_CAP } from "./types.js";

/**
 * The default (and, in a hosted build, only) way a "run" produces steps: a
 * heuristic top-to-bottom walk that never executes a single line of `content`
 * — see per-language modules for what each heuristic actually covers.
 * `language` is `PortalFile.language` (classify.ts's values, e.g.
 * "python"/"javascript"/"typescript"); anything else falls back to
 * buildGenericTrace.
 */
export function buildTraceScript(
	content: string,
	language: string | undefined,
): TraceStep[] {
	const lines = content.split("\n");
	if (language === "python") return buildPythonTrace(lines);
	if (language === "javascript" || language === "typescript") {
		return buildJsTrace(lines);
	}
	return buildGenericTrace(lines);
}
