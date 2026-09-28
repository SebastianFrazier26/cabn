import { TRACE_DEPTH_CAP, TRACE_STEP_CAP, type TraceStep } from "./types.js";

interface FnDef {
	name: string;
	/** 0-indexed, first line strictly inside the function's `{}` body. */
	bodyStart: number;
	/** 0-indexed, exclusive — the line the matching `}` is on. */
	bodyEnd: number;
}

/**
 * Replaces string/comment contents with spaces (newlines kept, so line
 * numbers stay aligned) so the brace-depth scan below never mistakes a `{`
 * inside a string or comment for real structure. Not a real lexer — no
 * regex-literal-vs-division disambiguation, and (like converter's own
 * codeScanner.ts) no nested `${}` tracking inside template literals — an
 * accepted gap for a heuristic trace, not a compiler.
 */
function maskStringsAndComments(content: string): string {
	let out = "";
	let i = 0;
	const n = content.length;
	while (i < n) {
		const ch = content[i];
		const next = content[i + 1];
		if (ch === "/" && next === "/") {
			while (i < n && content[i] !== "\n") {
				out += " ";
				i++;
			}
			continue;
		}
		if (ch === "/" && next === "*") {
			out += "  ";
			i += 2;
			while (i < n && !(content[i] === "*" && content[i + 1] === "/")) {
				out += content[i] === "\n" ? "\n" : " ";
				i++;
			}
			if (i < n) {
				out += "  ";
				i += 2;
			}
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const quote = ch;
			out += " ";
			i++;
			while (i < n && content[i] !== quote) {
				if (content[i] === "\\" && i + 1 < n) {
					out += content[i] === "\n" ? "\n" : " ";
					out += content[i + 1] === "\n" ? "\n" : " ";
					i += 2;
					continue;
				}
				out += content[i] === "\n" ? "\n" : " ";
				i++;
			}
			if (i < n) {
				out += " ";
				i++;
			}
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

const FUNCTION_DECL_RE =
	/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/;
const CONST_FN_RE =
	/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/;
const CALL_RE = /^([A-Za-z_$][\w$]*)\s*\(/;
const IMPORT_RE =
	/^import\b|^(?:export\s+)?(?:const|let|var)\s+\S+\s*=\s*require\(|^require\(/;

function lineStartOffsets(content: string): number[] {
	const offsets = [0];
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") offsets.push(i + 1);
	}
	return offsets;
}

/** Depth of `{}` nesting *before* each line starts, computed once over the masked content — a header line at depth 0 is top-level. */
function depthAtLineStart(masked: string, lineOffsets: number[]): number[] {
	const depths: number[] = new Array(lineOffsets.length).fill(0);
	let depth = 0;
	let lineIdx = 0;
	for (let i = 0; i < masked.length; i++) {
		if (lineIdx < lineOffsets.length && i === lineOffsets[lineIdx]) {
			depths[lineIdx] = depth;
			lineIdx++;
		}
		if (masked[i] === "{") depth++;
		else if (masked[i] === "}") depth = Math.max(0, depth - 1);
	}
	while (lineIdx < lineOffsets.length) depths[lineIdx++] = depth;
	return depths;
}

function lineOfOffset(offset: number, lineOffsets: number[]): number {
	let lo = 0;
	let hi = lineOffsets.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if ((lineOffsets[mid] ?? 0) <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

/** Offset of the matching `}` for the `{` at `openOffset` (ignoring string/comment content, already masked), or -1 if unbalanced. */
function findMatchingClose(masked: string, openOffset: number): number {
	let depth = 0;
	for (let i = openOffset; i < masked.length; i++) {
		if (masked[i] === "{") depth++;
		else if (masked[i] === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function findTopLevelDefs(
	lines: string[],
	masked: string,
	lineOffsets: number[],
): Map<string, FnDef> {
	const depths = depthAtLineStart(masked, lineOffsets);
	const defs = new Map<string, FnDef>();
	for (let i = 0; i < lines.length; i++) {
		if (depths[i] !== 0) continue;
		const trimmed = (lines[i] ?? "").trim();
		const declMatch = FUNCTION_DECL_RE.exec(trimmed);
		const constMatch = CONST_FN_RE.exec(trimmed);
		const name = declMatch?.[1] ?? constMatch?.[1] ?? constMatch?.[2];
		if (!name) continue;

		const headerOffset = lineOffsets[i] ?? 0;
		const openOffset = masked.indexOf("{", headerOffset);
		if (openOffset === -1) continue;
		const closeOffset = findMatchingClose(masked, openOffset);
		if (closeOffset === -1) continue;
		const bodyStartLine = lineOfOffset(openOffset, lineOffsets) + 1;
		const bodyEndLine = lineOfOffset(closeOffset, lineOffsets);
		defs.set(name, { name, bodyStart: bodyStartLine, bodyEnd: bodyEndLine });
	}
	return defs;
}

/** True for a blank line or one whose entire content is a comment — checked against the *masked* line (comments/strings blanked out) so a full-line `//...` reads the same as an actually-empty line, without a second comment-syntax regex duplicating maskStringsAndComments' own rules. */
function isBlankOrComment(maskedLine: string): boolean {
	return maskedLine.trim() === "";
}

function classifyAndMaybeCall(
	trimmed: string,
	lineIndex: number,
	depth: number,
	lines: string[],
	maskedLines: string[],
	defs: Map<string, FnDef>,
	steps: TraceStep[],
): void {
	if (IMPORT_RE.test(trimmed)) {
		steps.push({ line: lineIndex + 1, kind: "import" });
		return;
	}
	if (FUNCTION_DECL_RE.test(trimmed) || CONST_FN_RE.test(trimmed)) {
		const m = FUNCTION_DECL_RE.exec(trimmed) ?? CONST_FN_RE.exec(trimmed);
		const name = m?.[1] ?? m?.[2];
		steps.push({
			line: lineIndex + 1,
			kind: "def",
			note: name ? `define ${name}` : undefined,
		});
		return;
	}
	const call = CALL_RE.exec(trimmed.replace(/^(?:await|void|return)\s+/, ""));
	const target = call?.[1] ? defs.get(call[1]) : undefined;
	if (call && target) {
		steps.push({ line: lineIndex + 1, kind: "call", note: `call ${call[1]}` });
		stepIntoFunction(target, depth + 1, lines, maskedLines, defs, steps);
		return;
	}
	if (/^return\b/.test(trimmed)) {
		steps.push({ line: lineIndex + 1, kind: "return" });
		return;
	}
	steps.push({ line: lineIndex + 1, kind: "stmt" });
}

function stepIntoFunction(
	def: FnDef,
	depth: number,
	lines: string[],
	maskedLines: string[],
	defs: Map<string, FnDef>,
	steps: TraceStep[],
): void {
	if (depth > TRACE_DEPTH_CAP) return;
	for (
		let i = def.bodyStart;
		i < def.bodyEnd && steps.length < TRACE_STEP_CAP;
		i++
	) {
		if (isBlankOrComment(maskedLines[i] ?? "")) continue;
		const trimmed = (lines[i] ?? "").trim();
		if (trimmed === "}" || trimmed === "{") continue; // stray nested-block punctuation, not its own step
		classifyAndMaybeCall(trimmed, i, depth, lines, maskedLines, defs, steps);
	}
}

/** Heuristic JS/TS trace: top-level defs are registered (not walked at definition time), imports/statements are stepped in order, and a top-level call to a registered function — including a bottom-of-file `main();` — steps into that function's body. See maskStringsAndComments/CONST_FN_RE docs for the accepted precision gaps of a heuristic (not compiler-grade) scan. */
export function buildJsTrace(lines: string[]): TraceStep[] {
	const content = lines.join("\n");
	const masked = maskStringsAndComments(content);
	const maskedLines = masked.split("\n");
	const lineOffsets = lineStartOffsets(content);
	const depths = depthAtLineStart(masked, lineOffsets);
	const defs = findTopLevelDefs(lines, masked, lineOffsets);

	const steps: TraceStep[] = [];
	let i = 0;
	while (i < lines.length && steps.length < TRACE_STEP_CAP) {
		if (isBlankOrComment(maskedLines[i] ?? "") || depths[i] !== 0) {
			i++;
			continue;
		}
		const line = lines[i] ?? "";
		const trimmed = line.trim();
		if (trimmed === "}" || trimmed === "{") {
			i++;
			continue;
		}

		const declMatch = FUNCTION_DECL_RE.exec(trimmed);
		const constMatch = CONST_FN_RE.exec(trimmed);
		const defName = declMatch?.[1] ?? constMatch?.[1] ?? constMatch?.[2];
		if (defName && defs.has(defName)) {
			steps.push({ line: i + 1, kind: "def", note: `define ${defName}` });
			i = defs.get(defName)?.bodyEnd ?? i + 1;
			i++; // skip the closing `}` line itself
			continue;
		}

		classifyAndMaybeCall(trimmed, i, 0, lines, maskedLines, defs, steps);
		i++;
	}
	return steps;
}
