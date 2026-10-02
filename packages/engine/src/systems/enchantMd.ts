/**
 * Turns one line of markdown source into styled segments for FileScene's
 * "enchanted markdown" rendering. Deliberately not a full CommonMark parser —
 * headings/bold/italic/code/links/list-bullets cover what a source file's
 * markdown actually uses, and a line-at-a-time transform is what a
 * virtualized, line-windowed scene can consume without re-parsing the whole
 * file on every scroll.
 */
export type MdSegmentStyle =
	| "heading1"
	| "heading2"
	| "heading3"
	| "bold"
	| "italic"
	| "boldItalic"
	| "link"
	| "code"
	| "plain";

export interface MdSegment {
	text: string;
	style: MdSegmentStyle;
	/** Only set on style: "link" segments. */
	href?: string;
	/** Source offsets within the line of the characters this segment paints — the hidden markup (`#`, backticks, `**`, a list marker) sits outside every segment, which is what lets a click on painted text find its source column. */
	from: number;
	to: number;
}

export interface EnchantedLine {
	segments: MdSegment[];
	/** 1-6, or null when the line isn't a heading. */
	headingLevel: number | null;
	isListItem: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;

// Order matters: code spans first (their contents must not be re-parsed for
// bold/italic/links), then bold+italic together (***x***/___x___), then bold,
// then italic, then links. Each alternative is its own capture group so a
// single exec loop can tell which one fired. The link's text excludes `[`, and
// its target allows one level of balanced parens (as CommonMark does, for URLs
// like `wiki/Foo_(bar)`) but no unbalanced `(`; both are length-capped. A bare
// `(` ending the target is what keeps lines like `[[[[...` or `[a](` repeated
// linear: every `[` stops at the next `[` or `(` instead of rescanning up to the
// cap (2026-10-01).
const INLINE_RE =
	/`([^`]+)`|\*\*\*([^*]+)\*\*\*|___([^_]+)___|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^[\]]{1,500})\]\(((?:[^()]|\([^()]{0,512}\)){1,2048})\)/g;

function parseInline(text: string, base: number): MdSegment[] {
	const segments: MdSegment[] = [];
	const push = (
		segText: string,
		style: MdSegmentStyle,
		from: number,
		href?: string,
	) => {
		const start = base + from;
		segments.push({
			text: segText,
			style,
			...(href === undefined ? {} : { href }),
			from: start,
			to: start + segText.length,
		});
	};
	let lastIndex = 0;
	INLINE_RE.lastIndex = 0;

	for (const match of text.matchAll(INLINE_RE)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			push(text.slice(lastIndex, index), "plain", lastIndex);
		}

		const [
			,
			code,
			boldItalic1,
			boldItalic2,
			bold1,
			bold2,
			italic1,
			italic2,
			linkText,
			linkHref,
		] = match;
		if (code !== undefined) {
			push(code, "code", index + 1);
		} else if (boldItalic1 !== undefined || boldItalic2 !== undefined) {
			push((boldItalic1 ?? boldItalic2) as string, "boldItalic", index + 3);
		} else if (bold1 !== undefined || bold2 !== undefined) {
			push((bold1 ?? bold2) as string, "bold", index + 2);
		} else if (italic1 !== undefined || italic2 !== undefined) {
			push((italic1 ?? italic2) as string, "italic", index + 1);
		} else if (linkText !== undefined) {
			push(linkText, "link", index + 1, linkHref);
		}

		lastIndex = index + match[0].length;
	}

	if (lastIndex < text.length) {
		push(text.slice(lastIndex), "plain", lastIndex);
	}
	if (segments.length === 0) push(text, "plain", 0);
	return segments;
}

export function enchantMdLine(line: string): EnchantedLine {
	const headingMatch = HEADING_RE.exec(line);
	if (headingMatch) {
		// Both groups are mandatory in HEADING_RE (never inside an alternation),
		// so they're always present on a successful match — the `?? ""` fallback
		// only exists to satisfy noUncheckedIndexedAccess, never actually taken.
		const level = (headingMatch[1] ?? "").length;
		const style: MdSegmentStyle =
			level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3";
		const rest = headingMatch[2] ?? "";
		// `.*$` runs to the end of the line, so the text starts that far back.
		const base = line.length - rest.length;
		return {
			segments: rest
				? parseInline(rest, base).map((s) => ({
						...s,
						style: s.style === "plain" ? style : s.style,
					}))
				: [{ text: "", style, from: base, to: base }],
			headingLevel: level,
			isListItem: false,
		};
	}

	const listMatch = LIST_ITEM_RE.exec(line);
	if (listMatch) {
		const rest = listMatch[2] ?? "";
		return {
			segments: parseInline(rest, line.length - rest.length),
			headingLevel: null,
			isListItem: true,
		};
	}

	return {
		segments: parseInline(line, 0),
		headingLevel: null,
		isListItem: false,
	};
}
