// U+001E (record separator) prefixes each line marker so it can never be
// confused with the target script's own stdout/stderr output, which is
// vanishingly unlikely to contain a control character no keyboard produces.
export const LINE_MARKER_PREFIX = "\x1eLINE ";

/**
 * `sys.settrace`, restricted to frames whose `co_filename` is exactly the
 * target file — a module the target imports (even a local sibling file) is
 * never traced, only the entry script itself, matching the milestone's "line
 * tracing ... restricted to the target file". Markers go to stderr (a
 * separate stream from the script's own stdout) so the server-side parser
 * only ever has to disentangle one stream's worth of interleaving. `argv[1]`
 * is the absolute, already-path-confined file the exec runner resolved —
 * this script never does its own path handling.
 */
export const PYTHON_TRACER_SOURCE = `
import runpy
import sys

_target = sys.argv[1]

def _cabn_trace(frame, event, arg):
    if event == "line" and frame.f_code.co_filename == _target:
        sys.stderr.write(${JSON.stringify(LINE_MARKER_PREFIX)} + str(frame.f_lineno) + "\\n")
        sys.stderr.flush()
    return _cabn_trace

sys.settrace(_cabn_trace)
try:
    runpy.run_path(_target, run_name="__main__")
finally:
    sys.settrace(None)
`;

export interface LineEvent {
	line: number;
}

export interface TraceChunkResult {
	events: LineEvent[];
	/** Stderr text with every complete marker stripped out — the target script's own stderr, forwarded to the client as-is. */
	text: string;
	/** Held-back tail that might be the start of a marker split across two stream chunks — pass back in as `carry` on the next call. */
	carry: string;
}

// A RegExp built from a string, not a `/.../ ` literal — Biome's
// noControlCharactersInRegex rule flags a literal control character in a
// regex literal specifically; the constructor form is the accepted escape
// hatch for a genuinely-intentional one (see LINE_MARKER_PREFIX's own doc for
// why U+001E is the right choice here).
const MARKER_RE = new RegExp(`${LINE_MARKER_PREFIX}(\\d+)\n`, "g");

/**
 * Pure, stateless per call (all state is the `carry` the caller threads
 * through) — parses complete `\x1eLINE n\n` markers out of a stderr chunk,
 * emitting each as a structured line event and returning the rest of the
 * text untouched. A marker split across a chunk boundary (the process wrote
 * the prefix but not the trailing newline yet) is held back in `carry`
 * rather than emitted as garbled text or a missed event.
 */
export function parseTraceChunk(
	carry: string,
	chunk: string,
): TraceChunkResult {
	const combined = carry + chunk;
	const events: LineEvent[] = [];
	let text = "";
	let lastIndex = 0;
	MARKER_RE.lastIndex = 0;
	let match: RegExpExecArray | null = MARKER_RE.exec(combined);
	while (match !== null) {
		text += combined.slice(lastIndex, match.index);
		const line = Number(match[1]);
		if (Number.isFinite(line)) events.push({ line });
		lastIndex = MARKER_RE.lastIndex;
		match = MARKER_RE.exec(combined);
	}
	const rest = combined.slice(lastIndex);
	const prefixIndex = rest.indexOf("\x1e");
	if (prefixIndex === -1) {
		text += rest;
		return { events, text, carry: "" };
	}
	// Everything before a trailing, not-yet-complete marker is real text;
	// everything from the marker prefix onward waits for the next chunk.
	text += rest.slice(0, prefixIndex);
	return { events, text, carry: rest.slice(prefixIndex) };
}

/** Called once the stream ends — any held-back `carry` was never going to complete, so it's real (if odd) text rather than a marker after all. */
export function flushTraceCarry(carry: string): string {
	return carry;
}
