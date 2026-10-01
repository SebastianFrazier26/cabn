export type OutlineSymbolKind =
	| "function"
	| "class"
	| "method"
	| "variable"
	| "type"
	| "heading"
	| "selector"
	| "key";

export interface OutlineSymbol {
	name: string;
	kind: OutlineSymbolKind;
	/** 0-based. */
	line: number;
	/** Leading-whitespace width (or heading level for markdown) — lets the picker indent nested entries. */
	depth: number;
}

interface Rule {
	pattern: RegExp;
	kind: OutlineSymbolKind;
}

/*
 * A line-regex outline rather than a syntax-tree walk: the six language packs
 * each name their definition nodes differently (FunctionDeclaration vs
 * FunctionDefinition vs ATXHeading1, ...), plain-text files (rust, go, yaml)
 * have no tree at all, and the tree is only partially parsed for big files
 * until CodeMirror's background parser catches up. One heuristic works the
 * same everywhere, at the cost of missing unusually formatted definitions.
 */
const JS_RULES: Rule[] = [
	{
		pattern:
			/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
		kind: "function",
	},
	{
		pattern:
			/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
		kind: "class",
	},
	{
		pattern: /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
		kind: "type",
	},
	{
		pattern:
			/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
		kind: "function",
	},
	{
		pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
		kind: "variable",
	},
	{
		pattern:
			/^\s+(?:(?:public|private|protected|static|readonly|async|get|set|override)\s+)*(?!if\b|for\b|while\b|switch\b|catch\b|return\b|function\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/,
		kind: "method",
	},
];

const PYTHON_RULES: Rule[] = [
	{ pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
	{ pattern: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
	{ pattern: /^([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=/, kind: "variable" },
];

const CSS_RULES: Rule[] = [
	{ pattern: /^\s*([^{}/@][^{}]*?)\s*\{/, kind: "selector" },
	{ pattern: /^\s*(@[\w-]+[^{]*?)\s*\{/, kind: "selector" },
];

const JSON_RULES: Rule[] = [
	// Top two nesting levels only — deeper keys turn the picker into a dump.
	{ pattern: /^(?: {0,4}|\t{0,2})"([^"]+)"\s*:/, kind: "key" },
];

const GENERIC_RULES: Rule[] = [
	...JS_RULES.slice(0, 3),
	...PYTHON_RULES.slice(0, 2),
	{
		pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
		kind: "function",
	},
	{
		pattern: /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_]\w*)/,
		kind: "type",
	},
	{ pattern: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: "function" },
];

function rulesFor(language: string | undefined): Rule[] {
	switch (language) {
		case "javascript":
		case "typescript":
			return JS_RULES;
		case "python":
			return PYTHON_RULES;
		case "css":
			return CSS_RULES;
		case "json":
			return JSON_RULES;
		default:
			return GENERIC_RULES;
	}
}

function indentWidth(line: string): number {
	let width = 0;
	for (const ch of line) {
		if (ch === " ") width++;
		else if (ch === "\t") width += 4;
		else break;
	}
	return width;
}

const WHITESPACE = /\s/;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

/**
 * What `/^(#{1,6})\s+(.+?)\s*#*\s*$/` captures, without running it: its
 * overlapping `\s*#*\s*` tail made it cubic on a heading with a long run of
 * spaces in it (seconds for a few thousand). The lazy name ends where the
 * longest trailing `\s*#*\s*` begins, but always keeps at least one char.
 */
export function atxHeading(
	line: string,
): { level: number; name: string } | null {
	let level = 0;
	while (line[level] === "#") level++;
	if (level < 1 || level > 6) return null;
	let start = level;
	while (start < line.length && WHITESPACE.test(line[start] ?? "")) start++;
	if (start === level) return null;
	if (start === line.length) {
		// All blank after the hashes: `\s+` gives a char back to the name.
		for (let i = line.length - 1; i > level; i--) {
			const ch = line[i] ?? "";
			if (!LINE_TERMINATOR.test(ch)) return { level, name: ch };
		}
		return null;
	}
	let tail = line.length;
	while (tail > start && WHITESPACE.test(line[tail - 1] ?? "")) tail--;
	while (tail > start && line[tail - 1] === "#") tail--;
	while (tail > start && WHITESPACE.test(line[tail - 1] ?? "")) tail--;
	const name = line.slice(start, Math.max(tail, start + 1));
	return LINE_TERMINATOR.test(name) ? null : { level, name };
}

function markdownOutline(lines: readonly string[]): OutlineSymbol[] {
	const symbols: OutlineSymbol[] = [];
	let inFence = false;
	lines.forEach((line, i) => {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		if (inFence) return;
		const heading = atxHeading(line);
		if (heading) {
			symbols.push({
				name: heading.name,
				kind: "heading",
				line: i,
				depth: heading.level - 1,
			});
		}
	});
	return symbols;
}

export function outlineSymbols(
	text: string,
	language: string | undefined,
): OutlineSymbol[] {
	const lines = text.split("\n");
	if (language === "markdown") return markdownOutline(lines);
	const rules = rulesFor(language);
	const symbols: OutlineSymbol[] = [];
	let inBlockComment = false;
	lines.forEach((line, i) => {
		if (inBlockComment) {
			if (line.includes("*/")) inBlockComment = false;
			return;
		}
		const trimmed = line.trimStart();
		if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
			inBlockComment = true;
			return;
		}
		if (/^(\/\/|#(?!!)|\*|--)/.test(trimmed) && language !== "css") return;
		for (const rule of rules) {
			const match = rule.pattern.exec(line);
			const name = match?.[1]?.trim();
			if (name) {
				symbols.push({
					name,
					kind: rule.kind,
					line: i,
					depth: indentWidth(line),
				});
				return;
			}
		}
	});
	return symbols;
}

/**
 * Case-insensitive subsequence filter ("gtl" finds "getLine"), ranked by how
 * early and how tightly the query letters land, ties kept in document order.
 */
export function filterSymbols(
	symbols: readonly OutlineSymbol[],
	query: string,
): OutlineSymbol[] {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return [...symbols];
	const scored: Array<{ symbol: OutlineSymbol; score: number; index: number }> =
		[];
	symbols.forEach((symbol, index) => {
		const name = symbol.name.toLowerCase();
		let pos = -1;
		let first = -1;
		for (const ch of q) {
			pos = name.indexOf(ch, pos + 1);
			if (pos === -1) return;
			if (first === -1) first = pos;
		}
		const substring = name.indexOf(q);
		const score = substring !== -1 ? substring : 100 + first + (pos - first);
		scored.push({ symbol, score, index });
	});
	scored.sort((a, b) => a.score - b.score || a.index - b.index);
	return scored.map((s) => s.symbol);
}

/**
 * Indentation-based fold range for languages without a syntax tree (rust,
 * go, yaml, plain text): a line folds over the following run of lines that
 * are indented deeper than it (blank lines inside the run included, trailing
 * blanks not). Returns the 0-based last line of the fold, or null.
 */
export function indentationFoldEnd(
	lines: readonly string[],
	index: number,
): number | null {
	const start = lines[index];
	if (start === undefined || start.trim().length === 0) return null;
	const base = indentWidth(start);
	let last: number | null = null;
	for (let i = index + 1; i < lines.length; i++) {
		const line = lines[i] as string;
		if (line.trim().length === 0) continue;
		if (indentWidth(line) <= base) break;
		last = i;
	}
	return last;
}

/** Parses a go-to-line entry: "42" or "42:7" (1-based) -> 0-based line/column clamped to the document, or null for junk. */
export function parseGoToLine(
	input: string,
	totalLines: number,
): { line: number; column: number } | null {
	const match = /^\s*(\d+)\s*(?::\s*(\d+))?\s*$/.exec(input);
	if (!match?.[1] || totalLines <= 0) return null;
	const line = Math.min(Math.max(Number(match[1]), 1), totalLines) - 1;
	const column = match[2] ? Math.max(Number(match[2]) - 1, 0) : 0;
	return { line, column };
}
