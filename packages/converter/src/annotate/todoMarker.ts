import { shortHash } from "../hash.js";
import { type CommentSpan, scanCode } from "./codeScanner.js";
import { langConfigFor } from "./langConfig.js";
import { locAt } from "./loc.js";
import { normalizeLine, uniquifyRules } from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

const MARKER_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/g;
// indexOf rather than `/<!--[\s\S]*?-->/g`, which rescans to the end of the
// file from every `<!--` when none is ever closed.
function htmlCommentSpans(content: string): CommentSpan[] {
	const spans: CommentSpan[] = [];
	let from = 0;
	for (;;) {
		const start = content.indexOf("<!--", from);
		if (start === -1) break;
		const close = content.indexOf("-->", start + 4);
		if (close === -1) break;
		spans.push({ start, end: close + 3 });
		from = close + 3;
	}
	return spans;
}

/**
 * WispNote/will-o-wisp, always tier 0 (cosmetic — see run.ts). Only counts a
 * marker actually inside a comment (line/block comment for a bracketBalance-
 * supported language, or an HTML comment for markdown) — a TODO inside a
 * string literal, or plain prose in a language this scanner doesn't cover,
 * is never flagged.
 */
export const todoMarker: Annotator = (ctx) => {
	const { file, content } = ctx;
	if (content === undefined) return [];

	const spans =
		file.kind === "markdown"
			? htmlCommentSpans(content)
			: commentSpansFor(file.language, content);
	if (spans.length === 0) return [];

	const results: ErrorAnnotation[] = [];
	// Markers and spans both run left to right, so one cursor replaces a
	// per-marker search of every span.
	let cursor = 0;
	MARKER_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = MARKER_PATTERN.exec(content);
	while (match !== null) {
		const index = match.index;
		const marker = match[1] ?? "";
		while (cursor < spans.length && (spans[cursor]?.end ?? 0) <= index)
			cursor++;
		const candidate = spans[cursor];
		const span =
			candidate !== undefined && index >= candidate.start
				? candidate
				: undefined;
		if (span) {
			const loc = locAt(content, index);
			const lineEnd = content.indexOf("\n", index);
			const noteEnd = Math.min(
				span.end,
				lineEnd === -1 ? content.length : lineEnd,
			);
			const note = normalizeLine(content.slice(index, noteEnd));
			results.push({
				code: "WispNote",
				rule: `todo:${marker}:${shortHash(note, 8)}`,
				message: `${marker} marker left in a comment.`,
				loc,
				species: "will-o-wisp",
				tier: 0,
			});
		}
		match = MARKER_PATTERN.exec(content);
	}
	return uniquifyRules(results);
};

function commentSpansFor(
	language: string | undefined,
	content: string,
): CommentSpan[] {
	const config = langConfigFor(language);
	if (!config) return [];
	return scanCode(content, config).commentSpans;
}
