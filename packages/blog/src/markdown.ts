/**
 * A small, safe markdown subset for prose posts. It produces a tree the React
 * side turns into elements, never an HTML string, so raw HTML in a post
 * renders as text. Started from the engine's release-notes parser
 * (packages/engine/src/systems/markdownLite.ts) and kept separate from it:
 * the blog must not depend on the engine.
 */
export type MdInline =
	| { kind: "text"; text: string }
	| { kind: "strong"; children: MdInline[] }
	| { kind: "em"; children: MdInline[] }
	| { kind: "code"; text: string }
	| { kind: "link"; text: string; href: string; external: boolean };

export type MdBlock =
	| { kind: "heading"; level: number; inline: MdInline[] }
	| { kind: "paragraph"; inline: MdInline[] }
	| { kind: "list"; ordered: boolean; items: MdInline[][] }
	| { kind: "code"; lang: string; text: string }
	| { kind: "quote"; paragraphs: MdInline[][] }
	| { kind: "image"; alt: string; src: string }
	| { kind: "rule" };

/**
 * Absolute http(s) URLs and site-relative paths survive. `//host` and
 * `/\host` are refused because browsers read both as another origin.
 */
export function safeUrl(raw: string): string | null {
	const value = raw.trim();
	if (value === "") return null;
	if (value.startsWith("/")) {
		return /^\/(?![/\\])/.test(value) ? value : null;
	}
	try {
		const url = new URL(value);
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
			const href = safeUrl(link[2] as string);
			if (href) {
				flush();
				out.push({
					kind: "link",
					text: link[1] as string,
					href,
					external: !href.startsWith("/"),
				});
			} else {
				buffer += link[1] as string;
			}
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
			const href = safeUrl(bare[0]);
			if (href) {
				flush();
				out.push({ kind: "link", text: bare[0], href, external: true });
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

const FENCE = /^\s*```\s*(\S*)\s*$/;
const IMAGE_LINE = /^\s*!\[([^\]]{0,500})\]\(([^)\s]{1,2000})\)\s*$/;
const RULE_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function parseMarkdown(source: string): MdBlock[] {
	const blocks: MdBlock[] = [];
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	let paragraph: string[] = [];
	let list: { ordered: boolean; items: string[] } | null = null;
	let quote: string[][] | null = null;

	const flushParagraph = () => {
		if (paragraph.length) {
			blocks.push({
				kind: "paragraph",
				inline: parseInline(paragraph.join(" ")),
			});
		}
		paragraph = [];
	};
	const flushList = () => {
		if (list) {
			blocks.push({
				kind: "list",
				ordered: list.ordered,
				items: list.items.map((item) => parseInline(item)),
			});
		}
		list = null;
	};
	const flushQuote = () => {
		if (quote) {
			const paragraphs = quote
				.filter((lines) => lines.length > 0)
				.map((lines) => parseInline(lines.join(" ")));
			if (paragraphs.length) blocks.push({ kind: "quote", paragraphs });
		}
		quote = null;
	};
	const flushAll = () => {
		flushParagraph();
		flushList();
		flushQuote();
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] as string;

		const fence = FENCE.exec(line);
		if (fence) {
			flushAll();
			const body: string[] = [];
			i++;
			while (i < lines.length && !/^\s*```\s*$/.test(lines[i] as string)) {
				body.push(lines[i] as string);
				i++;
			}
			const lang = fence[1] as string;
			blocks.push({
				kind: "code",
				// The language becomes part of a class name.
				lang: /^[\w+-]{1,32}$/.test(lang) ? lang : "",
				text: body.join("\n"),
			});
			continue;
		}

		const quoted = /^\s*>\s?(.*)$/.exec(line);
		if (quoted) {
			flushParagraph();
			flushList();
			quote ??= [[]];
			const text = (quoted[1] as string).trim();
			if (text === "") quote.push([]);
			else (quote[quote.length - 1] as string[]).push(text);
			continue;
		}
		flushQuote();

		if (line.trim() === "") {
			flushParagraph();
			flushList();
			continue;
		}

		// Before the bullet check: `---` and `***` would otherwise never get
		// here, and `- - -` is not supported as a rule.
		if (RULE_LINE.test(line)) {
			flushAll();
			blocks.push({ kind: "rule" });
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			flushAll();
			blocks.push({
				kind: "heading",
				level: (heading[1] as string).length,
				inline: parseInline((heading[2] as string).replace(/\s#+\s*$/, "")),
			});
			continue;
		}

		const image = IMAGE_LINE.exec(line);
		if (image) {
			flushAll();
			const src = safeUrl(image[2] as string);
			const alt = image[1] as string;
			if (src) blocks.push({ kind: "image", alt, src });
			else if (alt) {
				blocks.push({
					kind: "paragraph",
					inline: [{ kind: "text", text: alt }],
				});
			}
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

		flushList();
		paragraph.push(line.trim());
	}
	flushAll();
	return blocks;
}
