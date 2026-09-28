import { scanCode } from "./codeScanner.js";
import { langConfigFor } from "./langConfig.js";
import { locAt } from "./loc.js";
import {
	lineAnchor,
	type ParsedFile,
	parseFile,
	uniquifyRules,
} from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

const MAX_SYNTAX_ERRORS_PER_FILE = 3;
// Lezer's error recovery often emits a small burst of error nodes for one
// mistake (the bad token, then the construct it left unfinished); anything
// within this many lines of the last reported error is treated as that same
// root cause.
const CASCADE_LINES = 3;

const LANGUAGE_LABEL: Record<ParsedFile["language"], string> = {
	js: "JavaScript",
	ts: "TypeScript",
	python: "Python",
	css: "CSS",
	html: "HTML",
};

function describeAt(content: string, from: number, to: number): string {
	if (to > from) return `unexpected "${content.slice(from, to).slice(0, 24)}"`;
	const next = /^\s*(\S{1,24})/.exec(content.slice(from, from + 200));
	return next?.[1] ? `unexpected "${next[1]}"` : "unexpected end of file";
}

/** Where a zero-width error at end of file points: the last line with text on it, not the empty line after the final newline. */
function anchorIndex(content: string, from: number): number {
	if (from < content.length) return from;
	const trimmed = content.replace(/\s+$/, "");
	return Math.max(0, trimmed.length - 1);
}

/**
 * SyntaxError/imp: real parse errors from the Lezer grammars CodeMirror
 * already uses in the engine (JS/JSX, TS/TSX, Python, CSS, HTML). JSON stays
 * with parseFailure's rot-sprite (JSON.parse is the exact authority there)
 * and Markdown has no invalid syntax to report.
 *
 * Gremlin/imp split: in a language bracketBalance also covers (JS/TS/Python),
 * a file with any bracket or unterminated-string issue gets no imps at all.
 * Lezer reports the same unbalanced bracket as a cascade of errors, often
 * far from the opener, and the gremlin's message ("Unclosed '(' at 4:10")
 * is the more useful one. Once the brackets balance, whatever the parser
 * still rejects shows up as an imp. So one mistake never spawns both.
 *
 * Skipped outright: HTML with template syntax (`{{`/`{%`, which the plain
 * HTML grammar can't know) and Flow-annotated JS.
 */
export const syntaxError: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];
	const parsed = parseFile(file, content);
	if (!parsed) return [];
	if (parsed.language === "html" && /\{\{|\{%/.test(content)) return [];
	if (parsed.language === "js" && /^\s*(\/\/|\/\*)\s*@flow\b/.test(content))
		return [];

	const bracketConfig = langConfigFor(file.language);
	if (bracketConfig && scanCode(content, bracketConfig).bracketIssues.length)
		return [];

	const results: ErrorAnnotation[] = [];
	let lastLine = -Infinity;
	const cursor = parsed.tree.cursor();
	do {
		if (!cursor.type.isError) continue;
		const index = anchorIndex(content, cursor.from);
		const loc = locAt(content, index);
		if (loc.line - lastLine <= CASCADE_LINES) continue;
		lastLine = loc.line;
		results.push({
			code: "SyntaxError",
			rule: `syntax:${parsed.language}:${lineAnchor(content, index)}`,
			message: `${LANGUAGE_LABEL[parsed.language]} syntax error: ${describeAt(content, cursor.from, cursor.to)}.`,
			loc,
			species: "imp",
			tier: 2,
		});
		if (results.length >= MAX_SYNTAX_ERRORS_PER_FILE) break;
	} while (cursor.next());
	return uniquifyRules(results);
};
