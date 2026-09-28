import {
	MARKDOWN_PREVIEW_MAX_LIST_ITEMS,
	MARKDOWN_PREVIEW_MAX_NODES,
	MARKDOWN_PREVIEW_MAX_TEXT_CHARS,
	type MarkdownPreview,
	type MarkdownPreviewNode,
} from "@cabn/world-schema";

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const ORDERED_LIST_ITEM_RE = /^\s*\d+\.\s+/;
const FENCE_RE = /^```\s*(\S*)\s*$/;

function truncateText(text: string): { text: string; truncated: boolean } {
	if (text.length <= MARKDOWN_PREVIEW_MAX_TEXT_CHARS)
		return { text, truncated: false };
	return {
		text: text.slice(0, MARKDOWN_PREVIEW_MAX_TEXT_CHARS),
		truncated: true,
	};
}

/**
 * A deliberately simple block-level markdown parser — headings, paragraphs,
 * bullet/numbered lists, and fenced code blocks — not a full CommonMark
 * implementation (nested lists, tables, blockquotes, inline HTML all fall
 * through into plain paragraph text). That's the same tradeoff engine's
 * enchantMdLine makes for inline styling: this is a *preview*, not a
 * renderer, and the output is structured data the UI walks itself rather
 * than HTML, so a malicious README can't inject markup into the world UI.
 */
export function markdownToStructuredPreview(content: string): MarkdownPreview {
	const lines = content.split(/\r\n|\r|\n/);
	const nodes: MarkdownPreviewNode[] = [];
	let truncated = false;
	let paragraphBuffer: string[] = [];
	let listBuffer: string[] = [];
	let listOrdered = false;

	const flushParagraph = () => {
		if (paragraphBuffer.length === 0) return;
		const { text, truncated: cut } = truncateText(
			paragraphBuffer.join(" ").trim(),
		);
		paragraphBuffer = [];
		if (text.length === 0) return;
		nodes.push({ type: "paragraph", text });
		if (cut) truncated = true;
	};

	const flushList = () => {
		if (listBuffer.length === 0) return;
		const items = listBuffer
			.slice(0, MARKDOWN_PREVIEW_MAX_LIST_ITEMS)
			.map((item) => {
				const { text, truncated: cut } = truncateText(item);
				if (cut) truncated = true;
				return text;
			});
		if (listBuffer.length > MARKDOWN_PREVIEW_MAX_LIST_ITEMS) truncated = true;
		listBuffer = [];
		nodes.push({ type: "list", ordered: listOrdered, items });
	};

	let i = 0;
	while (i < lines.length) {
		if (nodes.length >= MARKDOWN_PREVIEW_MAX_NODES) {
			truncated = true;
			break;
		}

		const line = lines[i] ?? "";
		const fenceMatch = FENCE_RE.exec(line);
		if (fenceMatch) {
			flushParagraph();
			flushList();
			const language = fenceMatch[1] || undefined;
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !FENCE_RE.test(lines[i] ?? "")) {
				codeLines.push(lines[i] ?? "");
				i++;
			}
			i++; // consume the closing fence (or run off the end if unterminated)
			const { text, truncated: cut } = truncateText(codeLines.join("\n"));
			nodes.push({ type: "code", language, text });
			if (cut) truncated = true;
			continue;
		}

		const headingMatch = HEADING_RE.exec(line);
		if (headingMatch) {
			flushParagraph();
			flushList();
			const level = (headingMatch[1] ?? "").length;
			const { text, truncated: cut } = truncateText(
				(headingMatch[2] ?? "").trim(),
			);
			nodes.push({ type: "heading", level, text });
			if (cut) truncated = true;
			i++;
			continue;
		}

		const listMatch = LIST_ITEM_RE.exec(line);
		if (listMatch) {
			const ordered = ORDERED_LIST_ITEM_RE.test(line);
			if (listBuffer.length > 0 && ordered !== listOrdered) flushList();
			flushParagraph();
			listOrdered = ordered;
			listBuffer.push((listMatch[1] ?? "").trim());
			i++;
			continue;
		}

		if (line.trim().length === 0) {
			flushParagraph();
			flushList();
			i++;
			continue;
		}

		flushList();
		paragraphBuffer.push(line.trim());
		i++;
	}

	flushParagraph();
	flushList();

	if (nodes.length > MARKDOWN_PREVIEW_MAX_NODES) {
		nodes.length = MARKDOWN_PREVIEW_MAX_NODES;
		truncated = true;
	}

	return { kind: "markdown", nodes, truncated };
}
