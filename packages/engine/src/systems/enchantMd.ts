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
// single exec loop can tell which one fired.
const INLINE_RE =
	/`([^`]+)`|\*\*\*([^*]+)\*\*\*|___([^_]+)___|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/g;

function parseInline(text: string): MdSegment[] {
	const segments: MdSegment[] = [];
	let lastIndex = 0;
	INLINE_RE.lastIndex = 0;

	for (const match of text.matchAll(INLINE_RE)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			segments.push({ text: text.slice(lastIndex, index), style: "plain" });
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
			segments.push({ text: code, style: "code" });
		} else if (boldItalic1 !== undefined || boldItalic2 !== undefined) {
			segments.push({
				text: (boldItalic1 ?? boldItalic2) as string,
				style: "boldItalic",
			});
		} else if (bold1 !== undefined || bold2 !== undefined) {
			segments.push({ text: (bold1 ?? bold2) as string, style: "bold" });
		} else if (italic1 !== undefined || italic2 !== undefined) {
			segments.push({ text: (italic1 ?? italic2) as string, style: "italic" });
		} else if (linkText !== undefined) {
			segments.push({ text: linkText, style: "link", href: linkHref });
		}

		lastIndex = index + match[0].length;
	}

	if (lastIndex < text.length) {
		segments.push({ text: text.slice(lastIndex), style: "plain" });
	}
	if (segments.length === 0) segments.push({ text, style: "plain" });
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
		return {
			segments: rest
				? parseInline(rest).map((s) => ({
						...s,
						style: s.style === "plain" ? style : s.style,
					}))
				: [{ text: "", style }],
			headingLevel: level,
			isListItem: false,
		};
	}

	const listMatch = LIST_ITEM_RE.exec(line);
	if (listMatch) {
		return {
			segments: parseInline(listMatch[2] ?? ""),
			headingLevel: null,
			isListItem: true,
		};
	}

	return { segments: parseInline(line), headingLevel: null, isListItem: false };
}
