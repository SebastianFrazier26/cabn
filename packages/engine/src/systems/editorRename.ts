/** Half-open [from, to) character range. */
export interface TextRange {
	from: number;
	to: number;
}

export interface RenameOccurrence extends TextRange {
	/** 1-based, for display. */
	line: number;
	/** 0-based column of `from` within its line. */
	column: number;
	lineText: string;
}

/**
 * One document a rename touches. Today the spellbook only ever passes the
 * open file; cross-file rename is meant to plug in here by passing more
 * targets (every world file that imports the symbol) — `planRename` and the
 * preview UI already work per-target, so that later change is "gather more
 * targets + write each back", not a rewrite of the matching logic.
 */
export interface RenameTarget {
	path: string;
	text: string;
	/** Strings/comments/etc. — occurrences starting inside any of these are skipped. */
	excluded: readonly TextRange[];
}

export interface RenamePlan {
	oldName: string;
	newName: string;
	files: Array<{ path: string; occurrences: RenameOccurrence[] }>;
}

const DEFAULT_WORD_CHAR = /[\p{L}\p{N}_$]/u;
// CSS/HTML names (class names, custom properties, tag names) use hyphens.
const HYPHEN_WORD_CHAR = /[\p{L}\p{N}_$-]/u;

export function wordCharFor(language: string | undefined): RegExp {
	return language === "css" || language === "html"
		? HYPHEN_WORD_CHAR
		: DEFAULT_WORD_CHAR;
}

export function isValidIdentifier(
	name: string,
	language?: string | undefined,
): boolean {
	if (name.length === 0) return false;
	const wordChar = wordCharFor(language);
	for (const ch of name) if (!wordChar.test(ch)) return false;
	return !/^\p{N}/u.test(name);
}

/** The identifier touching `pos` (either side of the caret); `word` is "" when there is none. */
export function wordAt(
	text: string,
	pos: number,
	language?: string | undefined,
): TextRange & { word: string } {
	const wordChar = wordCharFor(language);
	let from = Math.max(0, Math.min(pos, text.length));
	let to = from;
	while (from > 0 && wordChar.test(text[from - 1] ?? "")) from--;
	while (to < text.length && wordChar.test(text[to] ?? "")) to++;
	return { from, to, word: text.slice(from, to) };
}

function insideAny(pos: number, ranges: readonly TextRange[]): boolean {
	for (const r of ranges) if (pos >= r.from && pos < r.to) return true;
	return false;
}

/**
 * Whole-identifier matches of `word` — `foo` never matches inside `foobar`
 * or `my_foo` — skipping any match that starts inside an excluded range.
 */
export function findOccurrences(
	text: string,
	word: string,
	excluded: readonly TextRange[] = [],
	language?: string | undefined,
): RenameOccurrence[] {
	if (word.length === 0) return [];
	const wordChar = wordCharFor(language);
	const occurrences: RenameOccurrence[] = [];
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") lineStarts.push(i + 1);
	}
	let lineIndex = 0;
	let index = text.indexOf(word);
	while (index !== -1) {
		const end = index + word.length;
		const before = text[index - 1] ?? "";
		const after = text[end] ?? "";
		const bounded = !wordChar.test(before) && !wordChar.test(after);
		if (bounded && !insideAny(index, excluded)) {
			while (
				lineIndex + 1 < lineStarts.length &&
				(lineStarts[lineIndex + 1] as number) <= index
			) {
				lineIndex++;
			}
			const lineStart = lineStarts[lineIndex] as number;
			const nextLineStart = lineStarts[lineIndex + 1];
			const lineEnd =
				nextLineStart === undefined ? text.length : nextLineStart - 1;
			occurrences.push({
				from: index,
				to: end,
				line: lineIndex + 1,
				column: index - lineStart,
				lineText: text.slice(lineStart, lineEnd),
			});
		}
		index = text.indexOf(word, index + 1);
	}
	return occurrences;
}

export function planRename(
	targets: readonly RenameTarget[],
	oldName: string,
	newName: string,
	language?: string | undefined,
): RenamePlan {
	return {
		oldName,
		newName,
		files: targets.map((t) => ({
			path: t.path,
			occurrences: findOccurrences(t.text, oldName, t.excluded, language),
		})),
	};
}

/** Pure application of a (possibly user-filtered) set of occurrences — the CM side dispatches the same changes as one undoable transaction instead. */
export function applyRename(
	text: string,
	occurrences: readonly TextRange[],
	newName: string,
): string {
	const sorted = [...occurrences].sort((a, b) => a.from - b.from);
	let out = "";
	let cursor = 0;
	for (const o of sorted) {
		out += text.slice(cursor, o.from) + newName;
		cursor = o.to;
	}
	return out + text.slice(cursor);
}

/**
 * Lezer node names across the six bundled language packs that hold prose
 * rather than code. Matched by substring so e.g. "TemplateString",
 * "LineComment", "BlockComment", "FormatString" are all covered without
 * listing every grammar's exact spelling.
 */
const NON_CODE_NODE_PATTERN = /String|Comment|Regexp|Docstring/;
/** Code islands inside a non-code node: JS template `${...}`, Python f-string `{...}`. */
const CODE_HOLE_NODE_NAMES = new Set(["Interpolation", "FormatReplacement"]);

export function isNonCodeNodeName(name: string): boolean {
	return !CODE_HOLE_NODE_NAMES.has(name) && NON_CODE_NODE_PATTERN.test(name);
}

/** Structural subset of @lezer/common's Tree — keeps this module free of a direct lezer import so it stays unit-testable against any parser. */
export interface IterableSyntaxTree {
	iterate(spec: {
		enter(node: {
			name: string;
			from: number;
			to: number;
		}): boolean | undefined;
	}): void;
}

/** Removes every `holes` span from `ranges`; both inputs may be unsorted/overlapping. */
export function subtractRanges(
	ranges: readonly TextRange[],
	holes: readonly TextRange[],
): TextRange[] {
	const sortedHoles = [...holes].sort((a, b) => a.from - b.from);
	const out: TextRange[] = [];
	for (const range of ranges) {
		let from = range.from;
		for (const hole of sortedHoles) {
			if (hole.to <= from || hole.from >= range.to) continue;
			if (hole.from > from) out.push({ from, to: hole.from });
			from = Math.max(from, hole.to);
		}
		if (from < range.to) out.push({ from, to: range.to });
	}
	return out;
}

/** Strings/comments from a parsed tree, with interpolations carved back out as code. */
export function nonCodeRanges(tree: IterableSyntaxTree): TextRange[] {
	const ranges: TextRange[] = [];
	const holes: TextRange[] = [];
	tree.iterate({
		enter(node) {
			if (CODE_HOLE_NODE_NAMES.has(node.name)) {
				holes.push({ from: node.from, to: node.to });
				return undefined;
			}
			if (isNonCodeNodeName(node.name)) {
				ranges.push({ from: node.from, to: node.to });
			}
			return undefined;
		},
	});
	// A string nested *inside* an interpolation (`${"x"}`) must stay excluded,
	// so each range only loses the holes that sit within it.
	return ranges.flatMap((r) =>
		subtractRanges(
			[r],
			holes.filter((h) => h.from > r.from || h.to < r.to),
		),
	);
}
