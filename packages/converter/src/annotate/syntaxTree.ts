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
