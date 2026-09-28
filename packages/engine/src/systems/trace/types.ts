/**
 * A single step of a simulated (or, via LocalRunProvider, real) run. `line`
 * is 1-indexed to match the gutter numbers FileScene already draws.
 */
export interface TraceStep {
	line: number;
	kind: "import" | "def" | "call" | "stmt" | "return";
	note?: string;
}

// Shared across every language heuristic so a pathological file (a huge
// recursive-looking call chain, a file with thousands of top-level
// statements) can't produce an unbounded trace — the parchment overlay is
// meant to read as a short guided walk, not a full interpreter.
export const TRACE_STEP_CAP = 400;
export const TRACE_DEPTH_CAP = 3;
