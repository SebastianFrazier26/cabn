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

// Standard regex-vs-division disambiguation: a `/` starts a regex literal
// when the previous significant token is one that leaves an expression
// expected next (an operator, one of these punctuators, one of these
// keywords, or start of file) — not after a value (identifier, number,
// string, template literal, `)` or `]`). This list is intentionally the
// common subset, not exhaustive (e.g. no `instanceof`).
const REGEX_OK_PUNCT = new Set([
	"(",
	",",
	"=",
	":",
	"[",
	"!",
	"&",
	"|",
	"?",
	"{",
	"}",
	";",
	"+",
	"-",
	"*",
	"%",
	"<",
	">",
	"^",
	"~",
]);
const REGEX_OK_KEYWORDS = new Set([
	"return",
	"typeof",
	"case",
	"do",
	"else",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"yield",
	"await",
]);
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
// Anchored per-slice (not global/sticky), so no lastIndex state to reset.
const NUMBER_PATTERN =
	/^(?:0[xXoObB][0-9a-fA-F]+n?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?n?)/;

/**
 * Looks ahead (without mutating the scanner's position) from the "/" at
 * `start` for the matching unescaped closing "/" plus any trailing flags.
 * Inside a `[...]` character class an unescaped "/" doesn't end the regex
 * (real regex syntax). Returns the end index (exclusive) of the whole
 * literal, or null if no closer appears before a newline or EOF — a regex
 * literal can never span a real line, so that means this wasn't one; the
 * caller falls back to treating the "/" as division rather than mis-eating
 * the rest of the file looking for a closer that was never coming.
 */
function scanRegexLiteral(content: string, start: number): number | null {
	let j = start + 1;
	let inClass = false;
	while (j < content.length && content[j] !== "\n") {
		const c = content[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "[") inClass = true;
		else if (c === "]") inClass = false;
		else if (c === "/" && !inClass) {
			j++;
			while (j < content.length && /[A-Za-z]/.test(content[j] ?? "")) j++;
			return j;
		}
		j++;
	}
	return null;
}

/**
 * A single-pass, comment/string-aware tokenizer shared by bracketBalance
 * (needs bracket issues) and todoMarker (needs to know which byte ranges are
 * comments) — one scan instead of two so neither has to re-derive the
 * other's notion of "am I inside a string right now". Not a real lexer: no
 * handling of language-specific escapes beyond backslash, no re-sync after
 * the first mismatch (a mismatch pops the stack and keeps scanning, which
 * can cascade into a second reported issue that's really the same root
 * cause) — acceptable false-negative/cascade risk for a lightweight,
 * dependency-free scanner. JS/TS template literals (`config.
 * templateLiteralDelim`) get real `${}` nesting support (see `inTemplateText`
 * below) specifically because *not* having it used to be the single biggest
 * source of cascades: one multi-line backtick string misread as
 * "unterminated" on its first newline turned the rest of the file's real
 * code into scanned-as-string-content, and vice versa.
 */
export function scanCode(content: string, config: LangConfig): ScanResult {
	const stack: {
		ch: string;
		line: number;
		col: number;
		templateResume?: boolean;
	}[] = [];
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
	// Template-literal text (outside any `${...}`) is tracked separately from
	// `inString`: unlike a quoted string, a newline inside it is legal, and a
	// bare `${` inside it hands control back to normal code scanning (so
	// brackets inside the interpolation are matched against `stack` like
	// anywhere else) until the matching `}` — marked on that `{`'s stack
	// frame via `templateResume` — hands control back to template text.
	let inTemplateText = false;
	const templateStack: { line: number; col: number; ch: string }[] = [];
	// JS/TS only (config.supportsRegexLiterals) — see REGEX_OK_PUNCT/KEYWORDS.
	// Starts true (start of file is an expression-expected position).
	let regexAllowed = true;

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
				regexAllowed = false; // a closed string is a value
				continue;
			}
			advance(1);
			continue;
		}
		if (inTemplateText) {
			if (content[i] === "\\") {
				advance(2);
				continue;
			}
			if (
				config.templateLiteralDelim &&
				content[i] === config.templateLiteralDelim
			) {
				advance(1);
				inTemplateText = false;
				templateStack.pop();
				regexAllowed = false; // a closed template literal is a value
				continue;
			}
			if (content[i] === "$" && content[i + 1] === "{") {
				stack.push({ ch: "{", line, col, templateResume: true });
				advance(2);
				inTemplateText = false;
				regexAllowed = true; // start of the interpolation's own expression
				continue;
			}
			advance(1); // includes newlines — template text spans lines freely
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
		if (config.templateLiteralDelim && ch === config.templateLiteralDelim) {
			templateStack.push({ line, col, ch });
			inTemplateText = true;
			advance(1);
			continue;
		}
		if (config.supportsRegexLiterals && ch === "/") {
			const regexEnd = regexAllowed ? scanRegexLiteral(content, i) : null;
			if (regexEnd !== null) {
				advance(regexEnd - i);
				regexAllowed = false; // a regex literal is a value
				continue;
			}
			// Division — or a "/" that could start a regex but had no closer
			// before a newline/EOF, so it wasn't one. Either way this "/" is an
			// operator, same as +/-/* etc., so an expression (maybe even a
			// regex) is expected right after it.
			regexAllowed = true;
			advance(1);
			continue;
		}

		if (OPENERS.has(ch)) {
			stack.push({ ch, line, col });
			regexAllowed = true;
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
				if (top.templateResume) inTemplateText = true;
				stack.pop();
			}
			// Matches REGEX_OK_PUNCT: "}" (block/statement end) leaves an
			// expression expected next; ")"/"]" end one (a value), same as an
			// identifier or number below.
			regexAllowed = ch === "}";
			advance(1);
			continue;
		}
		if (config.supportsRegexLiterals) {
			if (IDENT_START.test(ch)) {
				let j = i + 1;
				while (j < content.length && IDENT_PART.test(content[j] ?? "")) j++;
				regexAllowed = REGEX_OK_KEYWORDS.has(content.slice(i, j));
				advance(j - i);
				continue;
			}
			const numberMatch = NUMBER_PATTERN.exec(content.slice(i));
			if (numberMatch) {
				regexAllowed = false; // a number is a value
				advance(numberMatch[0].length);
				continue;
			}
			if (REGEX_OK_PUNCT.has(ch)) regexAllowed = true;
		}
		advance(1);
	}

	if (inLineComment)
		commentSpans.push({ start: commentStart, end: content.length });
	if (inBlockComment)
		commentSpans.push({ start: commentStart, end: content.length });
	// Any backtick(s) left on templateStack at EOF never found their closer —
	// whether still mid-text (inTemplateText) or paused inside an unclosed
	// `${...}` (whose own `{` is reported separately, below, via `stack`).
	for (const open of templateStack) {
		bracketIssues.push({
			type: "unterminated-string",
			ch: open.ch,
			loc: { line: open.line, col: open.col },
		});
	}
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
