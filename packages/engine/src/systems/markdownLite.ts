/**
 * A small, safe markdown subset for GitHub release notes: headings,
 * paragraphs, bullet/numbered lists, fenced code, and inline bold, italic,
 * code and links. It produces a tree the React side turns into elements —
 * never an HTML string — so raw HTML in a release body renders as text.
 */
export type MdInline =
	| { kind: "text"; text: string }
	| { kind: "strong"; children: MdInline[] }
	| { kind: "em"; children: MdInline[] }
	| { kind: "code"; text: string }
	| { kind: "link"; text: string; href: string };

export type MdBlock =
	| { kind: "heading"; level: number; inline: MdInline[] }
	| { kind: "paragraph"; inline: MdInline[] }
	| { kind: "list"; ordered: boolean; items: MdInline[][] }
	| { kind: "code"; text: string };

const MAX_BLOCKS = 200;

/** Only absolute http(s) links survive; everything else (javascript:, data:, relative) renders as plain text. */
export function safeHref(raw: string): string | null {
	try {
		const url = new URL(raw.trim());
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

export function parseInline(text: string, depth = 0): MdInline[] {
	const out: MdInline[] = [];
	let buffer = "";
	const flush = () => {
		if (buffer) out.push({ kind: "text", text: buffer });
		buffer = "";
	};
	let i = 0;
	while (i < text.length) {
		const rest = text.slice(i);
		const code = /^`([^`]+)`/.exec(rest);
		if (code) {
			flush();
			out.push({ kind: "code", text: code[1] as string });
			i += code[0].length;
			continue;
		}
		const link = /^\[([^\]]{1,500})\]\(([^)\s]{1,2000})\)/.exec(rest);
		if (link) {
			flush();
			const href = safeHref(link[2] as string);
			if (href) out.push({ kind: "link", text: link[1] as string, href });
			else out.push({ kind: "text", text: link[1] as string });
			i += link[0].length;
			continue;
		}
		const strong = depth < 3 ? /^(\*\*|__)(.+?)\1/.exec(rest) : null;
		if (strong) {
			flush();
			out.push({
				kind: "strong",
				children: parseInline(strong[2] as string, depth + 1),
			});
			i += strong[0].length;
			continue;
		}
		const em = depth < 3 ? /^(\*|_)([^*_\s][^*_]*?)\1/.exec(rest) : null;
		if (em && (i === 0 || !/\w/.test(text[i - 1] as string))) {
			flush();
			out.push({
				kind: "em",
				children: parseInline(em[2] as string, depth + 1),
			});
			i += em[0].length;
			continue;
		}
		const bare = /^https?:\/\/[^\s<>()]+/.exec(rest);
		if (bare && (i === 0 || /\s/.test(text[i - 1] as string))) {
			const href = safeHref(bare[0]);
			if (href) {
				flush();
				out.push({ kind: "link", text: bare[0], href });
				i += bare[0].length;
				continue;
			}
		}
		buffer += text[i];
		i++;
	}
	flush();
	return out;
}

export function parseMarkdownLite(source: string): MdBlock[] {
	const blocks: MdBlock[] = [];
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	let paragraph: string[] = [];
	let list: { ordered: boolean; items: string[] } | null = null;
	const flushParagraph = () => {
		if (paragraph.length)
			blocks.push({
				kind: "paragraph",
				inline: parseInline(paragraph.join(" ")),
			});
		paragraph = [];
	};
	const flushList = () => {
		if (list)
			blocks.push({
				kind: "list",
				ordered: list.ordered,
				items: list.items.map((item) => parseInline(item)),
			});
		list = null;
	};
	for (let i = 0; i < lines.length && blocks.length < MAX_BLOCKS; i++) {
		const line = lines[i] as string;
		if (/^\s*```/.test(line)) {
			flushParagraph();
			flushList();
			const body: string[] = [];
			i++;
			while (i < lines.length && !/^\s*```/.test(lines[i] as string)) {
				body.push(lines[i] as string);
				i++;
			}
			blocks.push({ kind: "code", text: body.join("\n") });
			continue;
		}
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			flushParagraph();
			flushList();
			blocks.push({
				kind: "heading",
				level: (heading[1] as string).length,
				inline: parseInline((heading[2] as string).replace(/\s#+\s*$/, "")),
			});
			continue;
		}
		const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
		const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (bullet || numbered) {
			flushParagraph();
			const ordered = !bullet;
			if (list && list.ordered !== ordered) flushList();
			list ??= { ordered, items: [] };
			list.items.push(((bullet ?? numbered) as RegExpExecArray)[1] as string);
			continue;
		}
		if (line.trim() === "") {
			flushParagraph();
			flushList();
			continue;
		}
		flushList();
		paragraph.push(line.trim());
	}
	flushParagraph();
	flushList();
	return blocks.slice(0, MAX_BLOCKS);
}
