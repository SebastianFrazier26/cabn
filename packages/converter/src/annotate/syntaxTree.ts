import type { PortalFile } from "@cabn/world-schema";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parser as cssParser } from "@lezer/css";
import { parser as htmlParser } from "@lezer/html";
import { parser as jsParser } from "@lezer/javascript";
import type { LRParser } from "@lezer/lr";
import { parser as pythonParser } from "@lezer/python";
import { shortHash } from "../hash.js";

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
const GAP_LINE_PATTERNS: Readonly<Record<TreeLanguage, readonly RegExp[]>> = {
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
		/\blambda\b[^:]*\//, // positional-only lambda parameters
		/\[\s*\*/, // PEP 646 star expression in a subscript
	],
	css: [/^\s*@import\b/], // layer()/supports() import conditions
	html: [],
};
const GAP_ANCESTORS = new Set(["PatternProperty", "ObjectPattern"]);
// JSX comment children (`{/* note */}`) and empty expressions (`{}`).
const JSX_EMPTY_EXPRESSION = /\{\s*(?:\/\*[\s\S]*?\*\/\s*)*\}/g;

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
	const jsxSpans: { start: number; end: number }[] = [];
	if (language === "js" || language === "ts") {
		for (const m of content.matchAll(JSX_EMPTY_EXPRESSION)) {
			jsxSpans.push({ start: m.index, end: m.index + m[0].length });
		}
	}
	const patterns = GAP_LINE_PATTERNS[language];
	const out: { from: number; to: number }[] = [];
	const cursor = parsed.tree.cursor();
	do {
		if (!cursor.type.isError) continue;
		const { from, to } = cursor;
		if (jsxSpans.some((s) => from >= s.start && from <= s.end)) continue;
		const lineStart = content.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
		const lineEndAt = content.indexOf("\n", from);
		const line = content.slice(
			lineStart,
			lineEndAt === -1 ? content.length : lineEndAt,
		);
		if (patterns.some((p) => p.test(line))) continue;
		if (inGapAncestor(cursor.node)) continue;
		out.push({ from, to });
	} while (cursor.next());
	return out;
}

export function nodeText(parsed: ParsedFile, node: SyntaxNode): string {
	return parsed.content.slice(node.from, node.to);
}

/** Whitespace-collapsed, trimmed text of the line containing `index` — the content anchor rule strings hash. */
export function lineTextAt(content: string, index: number): string {
	const start = content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
	const endAt = content.indexOf("\n", index);
	const end = endAt === -1 ? content.length : endAt;
	return normalizeLine(content.slice(start, end));
}

export function normalizeLine(line: string): string {
	return line.trim().replace(/\s+/g, " ");
}

/**
 * Rule strings anchor to *what the offending line says*, not where it is:
 * a loc-based rule would count as "fixed" the moment the player adds a line
 * above it. Hashing keeps rule strings short and keeps a flagged line's text
 * (which may be a secret, for LeakedSecret) out of the rule itself.
 */
export function lineAnchor(content: string, index: number): string {
	return shortHash(lineTextAt(content, index), 8);
}

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
