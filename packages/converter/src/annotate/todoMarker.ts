import { shortHash } from "../hash.js";
import { type CommentSpan, scanCode } from "./codeScanner.js";
import { langConfigFor } from "./langConfig.js";
import { locAt } from "./loc.js";
import { normalizeLine, uniquifyRules } from "./syntaxTree.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

const MARKER_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/g;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

function htmlCommentSpans(content: string): CommentSpan[] {
	const spans: CommentSpan[] = [];
	HTML_COMMENT_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = HTML_COMMENT_PATTERN.exec(content);
	while (match !== null) {
		spans.push({ start: match.index, end: match.index + match[0].length });
		match = HTML_COMMENT_PATTERN.exec(content);
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
	MARKER_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = MARKER_PATTERN.exec(content);
	while (match !== null) {
		const index = match.index;
		const marker = match[1] ?? "";
		const span = spans.find((s) => index >= s.start && index < s.end);
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
