import type { LangConfig } from "./langConfig.js";

export interface BracketIssue {
	type: "unclosed" | "mismatched" | "unexpected-close" | "unterminated-string";
	ch: string;
	loc: { line: number; col: number };
}

export interface CommentSpan {
	start: number;
	end: number;
}

export interface ScanResult {
	bracketIssues: BracketIssue[];
	commentSpans: CommentSpan[];
}

const CLOSE_TO_OPEN: Readonly<Record<string, string>> = {
	")": "(",
	"]": "[",
	"}": "{",
};
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/**
 * A single-pass, comment/string-aware tokenizer shared by bracketBalance
 * (needs bracket issues) and todoMarker (needs to know which byte ranges are
 * comments) — one scan instead of two so neither has to re-derive the
 * other's notion of "am I inside a string right now". Not a real lexer: no
 * handling of language-specific escapes beyond backslash, no nested
 * template-literal `${}` bracket tracking (a `` `${x}` `` reopens brackets
 * inside what this scanner still treats as string content) — acceptable
 * false-negative risk for a lightweight, dependency-free scanner.
 */
export function scanCode(content: string, config: LangConfig): ScanResult {
	const stack: { ch: string; line: number; col: number }[] = [];
	const bracketIssues: BracketIssue[] = [];
	const commentSpans: CommentSpan[] = [];

	let i = 0;
	let line = 0;
	let col = 0;
	let inLineComment = false;
	let commentStart = -1;
	let inBlockComment = false;
	let inString: string | null = null;
	let stringIsTriple = false;
	let stringStart = { line: 0, col: 0 };

	const advance = (n: number): void => {
		for (let k = 0; k < n && i < content.length; k++) {
			if (content[i] === "\n") {
				line++;
				col = 0;
			} else {
				col++;
			}
			i++;
		}
	};

	while (i < content.length) {
		if (inLineComment) {
			if (content[i] === "\n") {
				inLineComment = false;
				commentSpans.push({ start: commentStart, end: i });
			}
			advance(1);
			continue;
		}
		if (inBlockComment) {
			const closer = config.blockComment?.[1];
			if (closer && content.startsWith(closer, i)) {
				advance(closer.length);
				inBlockComment = false;
				commentSpans.push({ start: commentStart, end: i });
			} else {
				advance(1);
			}
			continue;
		}
		if (inString !== null) {
			if (stringIsTriple) {
				if (content.startsWith(inString, i)) {
					advance(inString.length);
					inString = null;
					stringIsTriple = false;
				} else {
					advance(1);
				}
				continue;
			}
			if (content[i] === "\\") {
				advance(2);
				continue;
			}
			if (content[i] === "\n") {
				bracketIssues.push({
					type: "unterminated-string",
					ch: inString,
					loc: stringStart,
				});
				inString = null;
				continue;
			}
			if (content[i] === inString) {
				advance(1);
				inString = null;
				continue;
			}
			advance(1);
			continue;
		}

		if (config.lineComment && content.startsWith(config.lineComment, i)) {
			inLineComment = true;
			commentStart = i;
			advance(config.lineComment.length);
			continue;
		}
		if (config.blockComment && content.startsWith(config.blockComment[0], i)) {
			inBlockComment = true;
			commentStart = i;
			advance(config.blockComment[0].length);
			continue;
		}
		const triple = config.tripleStrings?.find((t) => content.startsWith(t, i));
		if (triple) {
			inString = triple;
			stringIsTriple = true;
			stringStart = { line, col };
			advance(triple.length);
			continue;
		}
		const ch = content[i] ?? "";
		if (config.strings.includes(ch)) {
			inString = ch;
			stringIsTriple = false;
			stringStart = { line, col };
			advance(1);
			continue;
		}

		if (OPENERS.has(ch)) {
			stack.push({ ch, line, col });
			advance(1);
			continue;
		}
		if (CLOSERS.has(ch)) {
			const expected = CLOSE_TO_OPEN[ch];
			const top = stack[stack.length - 1];
			if (!top) {
				bracketIssues.push({
					type: "unexpected-close",
					ch,
					loc: { line, col },
				});
			} else if (top.ch !== expected) {
				bracketIssues.push({
					type: "mismatched",
					ch: top.ch,
					loc: { line: top.line, col: top.col },
				});
				stack.pop();
			} else {
				stack.pop();
			}
			advance(1);
			continue;
		}
		advance(1);
	}

	if (inLineComment)
		commentSpans.push({ start: commentStart, end: content.length });
	if (inBlockComment)
		commentSpans.push({ start: commentStart, end: content.length });
	if (inString !== null && !stringIsTriple) {
		bracketIssues.push({
			type: "unterminated-string",
			ch: inString,
			loc: stringStart,
		});
	}
	for (const opener of stack) {
		bracketIssues.push({
			type: "unclosed",
			ch: opener.ch,
			loc: { line: opener.line, col: opener.col },
		});
	}

	return { bracketIssues, commentSpans };
}
