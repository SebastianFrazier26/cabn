import type { PortalFile } from "@cabn/world-schema";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parser as cssParser } from "@lezer/css";
import { parser as htmlParser } from "@lezer/html";
import { parser as jsParser } from "@lezer/javascript";
import type { LRParser } from "@lezer/lr";
import { parser as pythonParser } from "@lezer/python";
import { shortHash } from "../hash.js";
import { locAt } from "./loc.js";

export type TreeLanguage = "js" | "ts" | "python" | "css" | "html";

export interface ParsedFile {
	language: TreeLanguage;
	tree: Tree;
	content: string;
}

/**
 * Past this size the tree-based annotators (syntaxError, deadCode, codeSmell)
 * skip a file entirely. walk.ts's own per-file cap is larger than this, and a
 * full Lezer parse plus several tree walks per file is the one per-file cost
 * that grows with the file — this keeps the in-browser re-check after a save
 * well under a frame budget's worth of blocking.
 */
export const MAX_TREE_CHARS = 200_000;

const jsx = jsParser.configure({ dialect: "jsx" });
const ts = jsParser.configure({ dialect: "ts" });
const tsx = jsParser.configure({ dialect: "ts jsx" });

function extOf(path: string): string {
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	return dot > slash ? path.slice(dot + 1).toLowerCase() : "";
}

// Dialect is chosen by extension, not just classify()'s `language`: .ts must
// not get JSX (`<T>(x) => x` is a generic arrow there, a tag in .tsx), and
// plain .js commonly carries JSX in React projects, so it gets the jsx
// dialect. .d.ts files are skipped by the annotators that care, not here.
function parserFor(
	file: PortalFile,
): { parser: LRParser; language: TreeLanguage } | undefined {
	const ext = extOf(file.path);
	switch (file.language) {
		case "javascript":
			return { parser: jsx, language: "js" };
		case "typescript":
			return { parser: ext === "tsx" ? tsx : ts, language: "ts" };
		case "python":
			return { parser: pythonParser, language: "python" };
		case "css":
			return { parser: cssParser, language: "css" };
		case "html":
			return { parser: htmlParser, language: "html" };
		default:
			return undefined;
	}
}

export function treeLanguageFor(file: PortalFile): TreeLanguage | undefined {
	return parserFor(file)?.language;
}

// One slot: run.ts calls every per-file annotator on the same file in a row,
// and so does the engine's re-check/live view, so the three tree-based
// annotators share one parse per file without any cross-file retention.
let cache: { key: string; content: string; parsed: ParsedFile } | undefined;

export function parseFile(
	file: PortalFile,
	content: string,
): ParsedFile | undefined {
	if (content.length > MAX_TREE_CHARS) return undefined;
	const selected = parserFor(file);
	if (!selected) return undefined;
	const key = `${selected.language}:${extOf(file.path)}`;
	if (cache && cache.key === key && cache.content === content) {
		return cache.parsed;
	}
	const parsed: ParsedFile = {
		language: selected.language,
		tree: selected.parser.parse(content),
		content,
	};
	cache = { key, content, parsed };
	return parsed;
}

// The Lezer grammars are written for editor highlighting, and are
// incomplete as validators: valid code using one of these constructs still
// gets error nodes. Each entry was found by running the annotators over this
// repo's own source (test/annotate/selfCorpus.test.ts) and over zod, fastify,
// minisearch and phaser, then reproduced against the pinned grammar version.
// TypeScript has no list: its gaps (catch-clause and definite-assignment
// annotations, type predicates in function types, `type` export specifiers,
// optional tuple members, `x! +=`, ...) were too many to enumerate, so TS is
// out of the imp's scope entirely (see syntaxError.ts).
type LineTest = Pick<RegExp, "test">;

// A line can hold one `lambda` per few characters, and `/\blambda\b[^:]*\//`
// rescans to the end of the line from each one. A `:` can never sit between
// the lambda and its `/`, so per `:`-separated segment the first lambda
// decides it.
const POSITIONAL_ONLY_LAMBDA: LineTest = {
	test(line: string): boolean {
		return line.split(":").some((segment) => {
			const lambda = /\blambda\b/.exec(segment);
			return lambda !== null && segment.includes("/", lambda.index + 6);
		});
	},
};

const GAP_LINE_PATTERNS: Readonly<Record<TreeLanguage, readonly LineTest[]>> = {
	js: [
		/^\s*(import|export)\b.*\b(with|assert)\s*\{/, // import attributes
		// @lezer/javascript 1.5.5 (2026-09-20) rejects a default on a shorthand
		// destructuring property (`{ a = 1 }`); in a parameter list the error
		// can land outside the pattern node, so it's matched by line as well.
		/[{,]\s*[A-Za-z_$][\w$]*\s*=(?![=>])/,
	],
	ts: [],
	python: [
		/^\s*@/, // PEP 614 arbitrary decorator expressions
		POSITIONAL_ONLY_LAMBDA, // positional-only lambda parameters
		/\[\s*\*/, // PEP 646 star expression in a subscript
	],
	css: [/^\s*@import\b/], // layer()/supports() import conditions
	html: [],
};
const GAP_ANCESTORS = new Set(["PatternProperty", "ObjectPattern"]);
const WHITESPACE = /\s/;

/**
 * Spans of JSX comment children (`{/* note *\/}`) and empty expressions
 * (`{}`): what `/\{\s*(?:\/\*[\s\S]*?\*\/\s*)*\}/g` matches, non-overlapping,
 * left to right. A scanner rather than that regex: `[\s\S]*?` can stretch
 * one comment across several, which is exponential on `{/**\/.../**\/ x}`, and
 * even a terminator-safe comment pattern rescans the same comment chain from
 * every `{` nested inside an earlier comment. Here each chain position's
 * outcome is computed once.
 */
export function jsxEmptyExpressionSpans(
	content: string,
): { start: number; end: number }[] {
	let commentEnds: number[] | undefined;
	const commentEndFrom = (from: number): number => {
		if (commentEnds === undefined) {
			commentEnds = [];
			for (
				let i = content.indexOf("*/");
				i !== -1;
				i = content.indexOf("*/", i + 1)
			)
				commentEnds.push(i);
		}
		let lo = 0;
		let hi = commentEnds.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((commentEnds[mid] ?? 0) < from) lo = mid + 1;
			else hi = mid;
		}
		return commentEnds[lo] ?? -1;
	};
	// Position just after a `{` or a comment -> end of the match through the
	// closing `}`, or -1 when no `}` can close it from there.
	const chainEnd = new Map<number, number>();
	const resolveChain = (start: number): number => {
		const visited: number[] = [];
		let p = start;
		let result = -1;
		for (;;) {
			const known = chainEnd.get(p);
			if (known !== undefined) {
				result = known;
				break;
			}
			visited.push(p);
			let q = p;
			while (q < content.length && WHITESPACE.test(content[q] ?? "")) q++;
			if (content[q] === "}") {
				result = q + 1;
				break;
			}
			if (content[q] !== "/" || content[q + 1] !== "*") break;
			const close = commentEndFrom(q + 2);
			if (close === -1) break;
			p = close + 2;
		}
		for (const v of visited) chainEnd.set(v, result);
		return result;
	};

	const spans: { start: number; end: number }[] = [];
	let from = 0;
	for (;;) {
		const open = content.indexOf("{", from);
		if (open === -1) break;
		const end = resolveChain(open + 1);
		if (end === -1) {
			from = open + 1;
		} else {
			spans.push({ start: open, end });
			from = end;
		}
	}
	return spans;
}

/** Whether `index` falls in one of `spans` (sorted, non-overlapping), ends inclusive. */
function inSpans(
	spans: readonly { start: number; end: number }[],
	index: number,
): boolean {
	let lo = 0;
	let hi = spans.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((spans[mid]?.start ?? 0) <= index) lo = mid + 1;
		else hi = mid;
	}
	const span = spans[lo - 1];
	return span !== undefined && index <= span.end;
}

function inGapAncestor(node: SyntaxNode): boolean {
	for (let p = node.parent; p; p = p.parent) {
		if (GAP_ANCESTORS.has(p.name)) return true;
	}
	return false;
}

/**
 * Error nodes that are really syntax errors: every error node in the tree
 * minus the known grammar gaps above. A file whose tree has none of these
 * parsed cleanly as far as cabn can tell.
 */
export function syntaxErrorNodes(
	parsed: ParsedFile,
): { from: number; to: number }[] {
	const { content, language } = parsed;
	const jsxSpans =
		language === "js" || language === "ts"
			? jsxEmptyExpressionSpans(content)
			: [];
	const patterns = GAP_LINE_PATTERNS[language];
	// A minified line can carry thousands of error nodes; test it once.
	const gapLine = new Map<number, boolean>();
	const out: { from: number; to: number }[] = [];
	const cursor = parsed.tree.cursor();
	do {
		if (!cursor.type.isError) continue;
		const { from, to } = cursor;
		if (inSpans(jsxSpans, from)) continue;
		// From the shared line table, not lastIndexOf: on one long line that
		// walked back to its start for every error. The one case where
		// lastIndexOf answered past `from` is an error at 0 on an empty first
		// line; it keeps that answer.
		const lineStart =
			from === 0 && content[0] === "\n" ? 1 : from - locAt(content, from).col;
		const lineKey = lineStart > from ? -1 : lineStart;
		let isGap = gapLine.get(lineKey);
		if (isGap === undefined) {
			const lineEndAt = content.indexOf("\n", Math.min(lineStart, from));
			const line = content.slice(
				lineStart,
				lineEndAt === -1 ? content.length : lineEndAt,
			);
			isGap = patterns.some((p) => p.test(line));
			gapLine.set(lineKey, isGap);
		}
		if (isGap) continue;
		if (inGapAncestor(cursor.node)) continue;
		out.push({ from, to });
	} while (cursor.next());
	return out;
}

export function nodeText(parsed: ParsedFile, node: SyntaxNode): string {
	return parsed.content.slice(node.from, node.to);
}

/**
 * The line-start key `lineTextAt`/`lineAnchor` cache against: same line, same
 * key, so both caches hit on repeat lookups into the same line regardless of
 * which exact index inside it was asked for.
 */
function lineKeyAt(content: string, index: number): number {
	const at = Math.max(0, Math.min(index, content.length));
	// lastIndexOf, which this replaced, put an index of 0 on an empty first
	// line on the line after it; kept.
	const start =
		at === 0 && content[0] === "\n" ? 1 : at - locAt(content, at).col;
	return start > at ? -1 : start;
}

/** Whitespace-collapsed, trimmed text of the line containing `index` — the content anchor rule strings hash. */
export function lineTextAt(content: string, index: number): string {
	// Every finding on a line asks for the same text; on one long minified
	// line, rebuilding it per finding was quadratic.
	if (content !== lineTextContent) {
		lineTextContent = content;
		lineTextCache = new Map();
	}
	const key = lineKeyAt(content, index);
	const cached = lineTextCache.get(key);
	if (cached !== undefined) return cached;
	const at = Math.max(0, Math.min(index, content.length));
	const start = key === -1 ? at : key;
	const endAt = content.indexOf("\n", Math.min(start, at));
	const end = endAt === -1 ? content.length : endAt;
	const text = normalizeLine(content.slice(start, end));
	lineTextCache.set(key, text);
	return text;
}
let lineTextContent: string | undefined;
let lineTextCache = new Map<number, string>();

export function normalizeLine(line: string): string {
	return line.trim().replace(/\s+/g, " ");
}

/**
 * Rule strings anchor to *what the offending line says*, not where it is:
 * a loc-based rule would count as "fixed" the moment the player adds a line
 * above it. Hashing keeps rule strings short and keeps a flagged line's text
 * (which may be a secret, for LeakedSecret) out of the rule itself.
 *
 * The hash itself is cached per line, same as lineTextAt's text: a file with
 * no newlines (a minified bundle, or an adversarial payload) is one line the
 * length of the whole file, and deadCode/codeSmell can report one finding per
 * node on it — re-hashing that line from scratch for every finding was
 * quadratic in the finding count.
 */
export function lineAnchor(content: string, index: number): string {
	if (content !== lineAnchorContent) {
		lineAnchorContent = content;
		lineAnchorCache = new Map();
	}
	const key = lineKeyAt(content, index);
	const cached = lineAnchorCache.get(key);
	if (cached !== undefined) return cached;
	const hash = shortHash(lineTextAt(content, index), 8);
	lineAnchorCache.set(key, hash);
	return hash;
}
let lineAnchorContent: string | undefined;
let lineAnchorCache = new Map<number, string>();

/** Appends `#2`, `#3`, ... to repeats so every rule in one file's result is unique (monster ids hash the rule). */
export function uniquifyRules<T extends { rule: string }>(items: T[]): T[] {
	const seen = new Map<string, number>();
	for (const item of items) {
		const n = (seen.get(item.rule) ?? 0) + 1;
		seen.set(item.rule, n);
		if (n > 1) item.rule = `${item.rule}#${n}`;
	}
	return items;
}

export function isTestFile(path: string): boolean {
	const lower = path.toLowerCase();
	const base = lower.split("/").pop() ?? lower;
	return (
		/(^|\/)(tests?|__tests__|spec|e2e)\//.test(lower) ||
		/\.(test|spec)\.[a-z]+$/.test(base) ||
		/^test_.*\.py$/.test(base) ||
		/_test\.py$/.test(base) ||
		base === "conftest.py"
	);
}

/**
 * "Meant to be run, so printing is its job": scripts/bin/tools dirs, CLI
 * entry points, a shebang, or a Python `__main__` guard. Test files count
 * too — printing from a test is noise, not a shipped leftover.
 */
export function isScriptLike(path: string, content: string): boolean {
	if (isTestFile(path)) return true;
	const lower = path.toLowerCase();
	const base = lower.split("/").pop() ?? lower;
	if (/(^|\/)(scripts?|bin|tools|examples?|cli)\//.test(lower)) return true;
	if (/^(cli|main|manage|setup|__main__)\.[a-z]+$/.test(base)) return true;
	if (content.startsWith("#!")) return true;
	if (/^if\s+__name__\s*==\s*['"]__main__['"]\s*:/m.test(content)) return true;
	return false;
}
