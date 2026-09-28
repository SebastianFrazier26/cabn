import type {
	AudioPreview,
	EmbedVerdict,
	MediaPreview,
	MediaSealedReason,
	PdfPreview,
	Portal,
	Position,
	RichPortalPreview,
	UrlPreview,
} from "@cabn/world-schema";
import { csvDelimiterForPath, isDelimitedTextPath, parseCsv } from "./csv.js";

/**
 * Pure half of the in-arch literal preview (render/archPreviews.ts owns the
 * canvas/Phaser half): which preview a portal shows, how it's laid out into
 * the arch opening, and which portals are close enough to deserve a detailed
 * texture at all. Kept free of Phaser/DOM so all of it is unit-testable.
 */

const CODE_FALLBACK_MAX_LINES = 40;

/** A CSV/TSV portal's first rows, parsed engine-side from its (text) code preview — no bundle field needed. */
export interface TablePreview {
	kind: "table";
	rows: string[][];
	truncated: boolean;
}

/** The sealed chest, carrying what it's allowed to say about the file: its name, size, and why it stayed sealed. */
export interface SealedDisplayPreview {
	kind: "sealed";
	name?: string;
	bytes?: number;
	reason?: MediaSealedReason;
}

/** A url preview plus embeds.json's build-time verdict: `embedBlocked` (the reason) is set only when the site's headers refuse framing, and then no surface mounts an iframe for it. */
export interface UrlDisplayPreview extends UrlPreview {
	embedBlocked?: string;
}

/** Everything an arch, the dock, or the file view can show — the bundle's richPreview kinds plus media.json's audio/PDF, embeds.json's url verdict and the engine-derived table. */
export type DisplayPreview =
	| Exclude<RichPortalPreview, { kind: "sealed" | "url" }>
	| UrlDisplayPreview
	| AudioPreview
	| PdfPreview
	| TablePreview
	| SealedDisplayPreview;

export type DisplayPreviewKind = DisplayPreview["kind"];

export const TABLE_PREVIEW_MAX_ROWS = 40;

export function tableFromText(
	text: string,
	path: string,
	maxRows = TABLE_PREVIEW_MAX_ROWS,
): TablePreview {
	const { rows, truncated } = parseCsv(text, {
		delimiter: csvDelimiterForPath(path),
		maxRows,
	});
	return { kind: "table", rows, truncated };
}

/**
 * The preview a portal actually shows, in-arch and in the expanded dock.
 * `media` is this portal's media.json entry, when the bundle has one — it
 * wins over world.json's richPreview (which is a sealed chest for audio/PDF,
 * kept for engines that predate media.json).
 *
 * `overrideContent` is a saved quill edit (save.fileOverrides) — it replaces
 * the converter's snapshot for code/text previews, since those are literal
 * file content and would otherwise show stale text. Image/markdown/url/sealed
 * previews are left alone: they're either a cabn.json override pointing
 * elsewhere or a rendering the engine can't cheaply redo from raw text.
 *
 * `embed` is this portal's embeds.json verdict. It only applies while its
 * url still matches the portal's url, so a stale or hand-edited entry can't
 * block a different page.
 *
 * A pre-M10 bundle has no `richPreview` at all: its `preview.lines` become a
 * code preview (coloured by `file.language` when known), and a binary file
 * with nothing to show becomes the sealed chest.
 */
export function effectiveRichPreview(
	portal: Pick<Portal, "file" | "preview" | "richPreview">,
	overrideContent?: string,
	media?: MediaPreview,
	embed?: EmbedVerdict,
): DisplayPreview {
	const sealed = (reason?: MediaSealedReason): SealedDisplayPreview => ({
		kind: "sealed",
		name: portal.file.name,
		bytes: portal.file.bytes,
		...(reason ? { reason } : {}),
	});
	if (media) return media.kind === "sealed" ? sealed(media.reason) : media;
	const resolved = baseRichPreview(portal, overrideContent);
	if (resolved.kind === "sealed") return sealed();
	if (
		resolved.kind === "url" &&
		embed &&
		!embed.framable &&
		embed.url === resolved.url
	)
		return { ...resolved, embedBlocked: embed.detail ?? "refuses framing" };
	if (resolved.kind === "code" && isDelimitedTextPath(portal.file.path)) {
		const table = tableFromText(
			overrideContent ?? resolved.lines.join("\n"),
			portal.file.path,
		);
		return {
			...table,
			truncated: table.truncated || (!overrideContent && resolved.truncated),
		};
	}
	return resolved;
}

function baseRichPreview(
	portal: Pick<Portal, "file" | "preview" | "richPreview">,
	overrideContent?: string,
): RichPortalPreview {
	const rich = portal.richPreview;
	if (overrideContent !== undefined) {
		if (!rich || rich.kind === "code") {
			const all = overrideContent.split("\n");
			return {
				kind: "code",
				lines: all.slice(0, CODE_FALLBACK_MAX_LINES),
				...languageField(
					rich?.kind === "code" ? rich.language : undefined,
					portal,
				),
				truncated: all.length > CODE_FALLBACK_MAX_LINES,
			};
		}
		if (rich.kind === "text") return { kind: "text", text: overrideContent };
	}
	if (rich) return rich;
	if (portal.file.binary && portal.preview.lines.length === 0)
		return { kind: "sealed" };
	return {
		kind: "code",
		lines: [...portal.preview.lines],
		...languageField(undefined, portal),
		truncated: portal.preview.truncated,
	};
}

function languageField(
	language: string | undefined,
	portal: Pick<Portal, "file">,
): { language?: string } {
	const resolved = language ?? portal.file.language;
	return resolved !== undefined ? { language: resolved } : {};
}

// --- syntax colouring ---------------------------------------------------

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number";
export interface CodeToken {
	text: string;
	kind: TokenKind;
}

// A deliberately small, language-agnostic highlighter: the in-arch preview
// is a few dozen characters wide and viewed in passing, so a rough "this is
// code" colouring is the goal. Exact highlighting belongs to the expanded
// dock, which uses CodeMirror (react/PortalPreview.tsx); pulling lezer
// parsers into the per-frame canvas path would cost far more than it buys.
const KEYWORDS = new Set([
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"def",
	"default",
	"elif",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"False",
	"fn",
	"for",
	"from",
	"func",
	"function",
	"if",
	"impl",
	"import",
	"in",
	"interface",
	"let",
	"match",
	"new",
	"None",
	"null",
	"pass",
	"pub",
	"raise",
	"return",
	"self",
	"static",
	"struct",
	"switch",
	"this",
	"throw",
	"true",
	"True",
	"try",
	"type",
	"undefined",
	"use",
	"var",
	"void",
	"while",
	"with",
	"yield",
]);

const HASH_COMMENT_LANGUAGES = new Set([
	"python",
	"toml",
	"yaml",
	"shell",
	"bash",
	"ruby",
	"r",
	"perl",
	"dockerfile",
	"makefile",
]);

function lineCommentMarkers(language: string): string[] {
	if (HASH_COMMENT_LANGUAGES.has(language)) return ["#"];
	if (language === "json" || language === "markdown") return [];
	if (language === "sql" || language === "lua") return ["--"];
	return ["//"];
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

export function tokenizeCodeLine(
	line: string,
	language: string | undefined,
): CodeToken[] {
	// No language means prose-ish or unknown text (.txt, .gitignore, LICENSE):
	// colouring "from"/"for" inside sentences reads as noise, not as code.
	if (language === undefined)
		return line ? [{ text: line, kind: "plain" }] : [];
	const markers = lineCommentMarkers(language);
	const tokens: CodeToken[] = [];
	let plain = "";
	const flushPlain = () => {
		if (plain) tokens.push({ text: plain, kind: "plain" });
		plain = "";
	};

	let i = 0;
	while (i < line.length) {
		const ch = line[i] as string;
		const marker = markers.find((m) => line.startsWith(m, i));
		if (marker) {
			flushPlain();
			tokens.push({ text: line.slice(i), kind: "comment" });
			return tokens;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			flushPlain();
			let j = i + 1;
			while (j < line.length && line[j] !== ch) {
				if (line[j] === "\\") j++;
				j++;
			}
			tokens.push({
				text: line.slice(i, Math.min(j + 1, line.length)),
				kind: "string",
			});
			i = j + 1;
			continue;
		}
		if (IDENT_START.test(ch)) {
			let j = i + 1;
			while (j < line.length && IDENT_PART.test(line[j] as string)) j++;
			const word = line.slice(i, j);
			if (KEYWORDS.has(word)) {
				flushPlain();
				tokens.push({ text: word, kind: "keyword" });
			} else {
				plain += word;
			}
			i = j;
			continue;
		}
		if (DIGIT.test(ch)) {
			flushPlain();
			let j = i + 1;
			while (j < line.length && /[0-9._xXa-fA-F]/.test(line[j] as string)) j++;
			tokens.push({ text: line.slice(i, j), kind: "number" });
			i = j;
			continue;
		}
		plain += ch;
		i++;
	}
	flushPlain();
	return tokens;
}

// --- text fitting -------------------------------------------------------

const ELLIPSIS = "…";

export function truncateToChars(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	return text.slice(0, Math.max(0, maxChars - 1)) + ELLIPSIS;
}

/** Greedy word wrap on a monospace grid; words longer than a line are hard-broken rather than overflowing the arch. */
export function wrapText(text: string, maxChars: number): string[] {
	if (maxChars <= 0) return [];
	const out: string[] = [];
	for (const paragraph of text.split("\n")) {
		let current = "";
		for (const rawWord of paragraph.split(/\s+/).filter(Boolean)) {
			let word = rawWord;
			while (word.length > maxChars) {
				if (current) {
					out.push(current);
					current = "";
				}
				out.push(word.slice(0, maxChars));
				word = word.slice(maxChars);
			}
			if (!word) continue;
			if (!current) current = word;
			else if (current.length + 1 + word.length <= maxChars)
				current += ` ${word}`;
			else {
				out.push(current);
				current = word;
			}
		}
		out.push(current);
	}
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** CSS `object-fit: contain` — largest rect with the source's aspect ratio that fits inside `box`, centred in it. */
export function fitContain(srcW: number, srcH: number, box: Rect): Rect {
	if (srcW <= 0 || srcH <= 0 || box.w <= 0 || box.h <= 0)
		return { x: box.x, y: box.y, w: 0, h: 0 };
	const scale = Math.min(box.w / srcW, box.h / srcH);
	const w = srcW * scale;
	const h = srcH * scale;
	return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

// --- layout -------------------------------------------------------------

export type ArchColorRole =
	| "codeBg"
	| "parchmentBg"
	| "urlBg"
	| "imageBg"
	| "sealedBg"
	| "ink"
	| "cream"
	| "keyword"
	| "string"
	| "comment"
	| "number"
	| "heading"
	| "muted"
	| "chestWood"
	| "chestDark"
	| "chestGold"
	| "audioBg"
	| "wave"
	| "pdfBg"
	| "tableBg"
	| "tableHeaderBg"
	| "tableRule";

export type ArchDrawOp =
	| { op: "fill"; rect: Rect; color: ArchColorRole }
	| {
			op: "text";
			x: number;
			y: number;
			text: string;
			color: ArchColorRole;
			sizePx: number;
			bold: boolean;
	  }
	/** Painter contain-fits the loaded image into `box` (natural size is only known once it loads). */
	| { op: "image"; asset: string; box: Rect }
	/** Painter decodes the audio (WebAudio, in the browser) and draws its peaks as waveformBars into `box`. */
	| { op: "waveform"; asset: string; box: Rect }
	/** Painter renders page 1 via lazily-loaded pdf.js and contain-fits it into `box`. */
	| { op: "pdfPage"; asset: string; box: Rect };

export interface ArchLayoutMetrics {
	/** Body text size in px at texture resolution. */
	fontPx: number;
	/** Monospace advance as a fraction of font size (~0.6 for Courier New). */
	charWidthRatio: number;
	lineHeightRatio: number;
	padding: number;
}

export const DEFAULT_ARCH_METRICS: ArchLayoutMetrics = {
	fontPx: 9,
	charWidthRatio: 0.6,
	lineHeightRatio: 1.25,
	padding: 5,
};

interface Grid {
	charsPerLine(sizePx: number): number;
	lineHeight(sizePx: number): number;
	inner: Rect;
}

function makeGrid(width: number, height: number, m: ArchLayoutMetrics): Grid {
	const inner = {
		x: m.padding,
		y: m.padding,
		w: Math.max(0, width - m.padding * 2),
		h: Math.max(0, height - m.padding * 2),
	};
	return {
		inner,
		charsPerLine: (sizePx) =>
			Math.max(1, Math.floor(inner.w / (sizePx * m.charWidthRatio))),
		lineHeight: (sizePx) => sizePx * m.lineHeightRatio,
	};
}

/**
 * Turns a preview into flat draw ops for a `width`×`height` canvas (the arch
 * opening at texture resolution). Everything that decides *what fits* —
 * wrap widths, line budgets, truncation, image boxes — happens here so it's
 * testable; the painter just executes ops.
 */
export function layoutArchPreview(
	preview: DisplayPreview,
	width: number,
	height: number,
	metrics: ArchLayoutMetrics = DEFAULT_ARCH_METRICS,
): ArchDrawOp[] {
	const grid = makeGrid(width, height, metrics);
	const full: Rect = { x: 0, y: 0, w: width, h: height };
	const body = metrics.fontPx;

	switch (preview.kind) {
		case "code": {
			const ops: ArchDrawOp[] = [{ op: "fill", rect: full, color: "codeBg" }];
			const chars = grid.charsPerLine(body);
			const lh = grid.lineHeight(body);
			const maxLines = Math.max(0, Math.floor(grid.inner.h / lh));
			preview.lines.slice(0, maxLines).forEach((line, row) => {
				const y = grid.inner.y + row * lh;
				let col = 0;
				for (const token of tokenizeCodeLine(
					line.replace(/\t/g, "  "),
					preview.language,
				)) {
					if (col >= chars) break;
					const text = truncateToChars(token.text, chars - col);
					ops.push({
						op: "text",
						x: grid.inner.x + col * body * metrics.charWidthRatio,
						y,
						text,
						color: token.kind === "plain" ? "cream" : token.kind,
						sizePx: body,
						bold: token.kind === "keyword",
					});
					col += text.length;
				}
			});
			return ops;
		}
		case "markdown": {
			const ops: ArchDrawOp[] = [
				{ op: "fill", rect: full, color: "parchmentBg" },
			];
			let y = grid.inner.y;
			const bottom = grid.inner.y + grid.inner.h;
			const emit = (
				lines: string[],
				sizePx: number,
				color: ArchColorRole,
				bold: boolean,
			): boolean => {
				const lh = grid.lineHeight(sizePx);
				for (const text of lines) {
					if (y + lh > bottom) return false;
					ops.push({
						op: "text",
						x: grid.inner.x,
						y,
						text,
						color,
						sizePx,
						bold,
					});
					y += lh;
				}
				return true;
			};
			for (const node of preview.nodes) {
				let ok: boolean;
				switch (node.type) {
					case "heading": {
						const size =
							node.level <= 1
								? body + 3
								: node.level === 2
									? body + 2
									: body + 1;
						ok = emit(
							wrapText(node.text, grid.charsPerLine(size)),
							size,
							"heading",
							true,
						);
						break;
					}
					case "paragraph":
						ok = emit(
							wrapText(node.text, grid.charsPerLine(body)),
							body,
							"ink",
							false,
						);
						break;
					case "list": {
						const chars = grid.charsPerLine(body);
						const lines = node.items.flatMap((item, i) => {
							const bullet = node.ordered ? `${i + 1}. ` : "• ";
							return wrapText(item, chars - bullet.length).map(
								(l, j) => (j === 0 ? bullet : " ".repeat(bullet.length)) + l,
							);
						});
						ok = emit(lines, body, "ink", false);
						break;
					}
					case "code": {
						const chars = grid.charsPerLine(body);
						ok = emit(
							node.text.split("\n").map((l) => truncateToChars(l, chars)),
							body,
							"comment",
							false,
						);
						break;
					}
				}
				if (!ok) break;
				y += grid.lineHeight(body) * 0.3;
			}
			return ops;
		}
		case "text": {
			const ops: ArchDrawOp[] = [
				{ op: "fill", rect: full, color: "parchmentBg" },
			];
			const lh = grid.lineHeight(body);
			const maxLines = Math.max(0, Math.floor(grid.inner.h / lh));
			const lines = wrapText(preview.text, grid.charsPerLine(body));
			const shown = lines.slice(0, maxLines);
			if (lines.length > maxLines && shown.length > 0) {
				const last = shown.length - 1;
				shown[last] = truncateToChars(
					`${shown[last]}${ELLIPSIS}`,
					grid.charsPerLine(body),
				);
			}
			shown.forEach((text, row) => {
				ops.push({
					op: "text",
					x: grid.inner.x,
					y: grid.inner.y + row * lh,
					text,
					color: "ink",
					sizePx: body,
					bold: false,
				});
			});
			return ops;
		}
		case "image":
			return [
				{ op: "fill", rect: full, color: "imageBg" },
				{ op: "image", asset: preview.asset, box: grid.inner },
			];
		case "url":
			return layoutUrlCard(preview, width, height, grid, metrics);
		case "audio":
			return layoutAudio(preview, width, height, grid, metrics);
		case "pdf":
			return layoutPdf(preview, width, height, grid, metrics);
		case "table":
			return layoutTable(preview, width, height, grid, metrics);
		case "sealed":
			return layoutSealed(preview, width, height, grid, metrics);
	}
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SEALED_REASON_TEXT: Record<MediaSealedReason, string> = {
	"too-large": "too large",
	budget: "over world budget",
	"type-mismatch": "type mismatch",
	unsupported: "no viewer",
	unread: "not read",
};

export function sealedReasonText(reason: MediaSealedReason): string {
	return SEALED_REASON_TEXT[reason];
}

function captionOp(
	text: string,
	y: number,
	width: number,
	grid: Grid,
	m: ArchLayoutMetrics,
	color: ArchColorRole = "muted",
): ArchDrawOp {
	const shown = truncateToChars(text, grid.charsPerLine(m.fontPx));
	return {
		op: "text",
		x: (width - shown.length * m.fontPx * m.charWidthRatio) / 2,
		y,
		text: shown,
		color,
		sizePx: m.fontPx,
		bold: false,
	};
}

function layoutAudio(
	preview: AudioPreview,
	width: number,
	height: number,
	grid: Grid,
	m: ArchLayoutMetrics,
): ArchDrawOp[] {
	const lh = grid.lineHeight(m.fontPx);
	const ops: ArchDrawOp[] = [
		{ op: "fill", rect: { x: 0, y: 0, w: width, h: height }, color: "audioBg" },
		captionOp(
			`♪ ${preview.format.toUpperCase()} · ${formatBytes(preview.bytes)}`,
			grid.inner.y,
			width,
			grid,
			m,
			"keyword",
		),
	];
	const box = {
		x: grid.inner.x,
		y: grid.inner.y + lh * 1.4,
		w: grid.inner.w,
		h: Math.max(0, grid.inner.h - lh * 1.4),
	};
	if (box.h > 0) ops.push({ op: "waveform", asset: preview.asset, box });
	return ops;
}

function layoutPdf(
	preview: PdfPreview,
	width: number,
	height: number,
	grid: Grid,
	m: ArchLayoutMetrics,
): ArchDrawOp[] {
	const lh = grid.lineHeight(m.fontPx);
	const bottom = grid.inner.y + grid.inner.h;
	const box = {
		x: grid.inner.x,
		y: grid.inner.y,
		w: grid.inner.w,
		h: Math.max(0, grid.inner.h - lh * 1.2),
	};
	const ops: ArchDrawOp[] = [
		{ op: "fill", rect: { x: 0, y: 0, w: width, h: height }, color: "pdfBg" },
	];
	if (box.h > 0) ops.push({ op: "pdfPage", asset: preview.asset, box });
	ops.push(
		captionOp(
			`PDF · ${formatBytes(preview.bytes)}`,
			bottom - lh,
			width,
			grid,
			m,
		),
	);
	return ops;
}

/**
 * Column widths (in characters) for a monospace table `chars` wide: each
 * column's natural width (longest visible cell, capped) plus a 1-char gap,
 * shrunk proportionally — never below 3 — when the natural total overflows.
 * Columns that still don't fit are dropped from the right.
 */
export function tableColumnChars(
	rows: readonly (readonly string[])[],
	chars: number,
	maxNatural = 14,
): number[] {
	const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
	const natural = Array.from({ length: cols }, (_, c) =>
		Math.min(maxNatural, Math.max(1, ...rows.map((r) => (r[c] ?? "").length))),
	);
	const gaps = Math.max(0, cols - 1);
	const total = natural.reduce((a, b) => a + b, 0) + gaps;
	if (total <= chars) return natural;
	const room = Math.max(0, chars - gaps);
	const scale = room / Math.max(1, total - gaps);
	const out: number[] = [];
	let used = 0;
	for (const n of natural) {
		const w = Math.max(3, Math.floor(n * scale));
		if (used + w > chars) break;
		out.push(w);
		used += w + 1;
	}
	return out;
}

function layoutTable(
	preview: TablePreview,
	width: number,
	height: number,
	grid: Grid,
	m: ArchLayoutMetrics,
): ArchDrawOp[] {
	const body = m.fontPx;
	const lh = grid.lineHeight(body) + 1;
	const charW = body * m.charWidthRatio;
	const ops: ArchDrawOp[] = [
		{ op: "fill", rect: { x: 0, y: 0, w: width, h: height }, color: "tableBg" },
	];
	const maxRows = Math.max(0, Math.floor(grid.inner.h / lh));
	const rows = preview.rows.slice(0, maxRows);
	const widths = tableColumnChars(rows, grid.charsPerLine(body));
	rows.forEach((row, r) => {
		const y = grid.inner.y + r * lh;
		if (r === 0) {
			ops.push({
				op: "fill",
				rect: { x: 0, y: y - 1, w: width, h: lh },
				color: "tableHeaderBg",
			});
		} else {
			ops.push({
				op: "fill",
				rect: { x: grid.inner.x, y: y - 1, w: grid.inner.w, h: 1 },
				color: "tableRule",
			});
		}
		let col = 0;
		widths.forEach((w, c) => {
			const cell = row[c] ?? "";
			if (cell)
				ops.push({
					op: "text",
					x: grid.inner.x + col * charW,
					y,
					text: truncateToChars(cell, w),
					color: r === 0 ? "heading" : "ink",
					sizePx: body,
					bold: r === 0,
				});
			col += w + 1;
		});
	});
	return ops;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function layoutUrlCard(
	preview: UrlDisplayPreview,
	width: number,
	height: number,
	grid: Grid,
	m: ArchLayoutMetrics,
): ArchDrawOp[] {
	const ops: ArchDrawOp[] = [
		{ op: "fill", rect: { x: 0, y: 0, w: width, h: height }, color: "urlBg" },
	];
	const body = m.fontPx;
	const lh = grid.lineHeight(body);
	let y = grid.inner.y;
	const host = truncateToChars(
		`↗ ${hostOf(preview.url)}`,
		grid.charsPerLine(body),
	);
	ops.push({
		op: "text",
		x: grid.inner.x,
		y,
		text: host,
		color: "keyword",
		sizePx: body,
		bold: true,
	});
	y += lh * 1.3;

	const titleSize = body + 1;
	const titleLh = grid.lineHeight(titleSize);
	const titleLines = wrapText(
		preview.title ?? preview.url,
		grid.charsPerLine(titleSize),
	);
	// With a fallback image the title gets at most 3 lines so the picture keeps
	// most of the card; without one the title is the whole card. A blocked
	// site keeps its last line for the "opens in browser" note, since no live
	// page will ever cover this card.
	const bottom =
		grid.inner.y + grid.inner.h - (preview.embedBlocked ? lh * 1.2 : 0);
	const titleBudget = preview.fallbackImage
		? 3
		: Math.floor((bottom - y) / titleLh);
	for (const text of titleLines.slice(0, Math.max(0, titleBudget))) {
		ops.push({
			op: "text",
			x: grid.inner.x,
			y,
			text,
			color: "cream",
			sizePx: titleSize,
			bold: true,
		});
		y += titleLh;
	}
	if (preview.fallbackImage) {
		y += lh * 0.4;
		const box = {
			x: grid.inner.x,
			y,
			w: grid.inner.w,
			h: Math.max(0, bottom - y),
		};
		if (box.h > 0) ops.push({ op: "image", asset: preview.fallbackImage, box });
	}
	if (preview.embedBlocked) {
		ops.push(
			captionOp(
				"↗ opens in tab",
				grid.inner.y + grid.inner.h - lh,
				width,
				grid,
				m,
			),
		);
	}
	return ops;
}

// 12×9 pixel chest; '.' transparent, 'w' wood, 'd' dark band/outline, 'g' gold lock.
const CHEST_PIXELS = [
	"..dddddddd..",
	".dwwwwwwwwd.",
	"dwwwwwwwwwwd",
	"dddddggddddd",
	"dwwwwggwwwwd",
	"dwwwwwwwwwwd",
	"dwwwwwwwwwwd",
	"dddddddddddd",
	".d........d.",
];

function layoutSealed(
	preview: SealedDisplayPreview,
	width: number,
	height: number,
	grid: Grid,
	m: ArchLayoutMetrics,
): ArchDrawOp[] {
	const ops: ArchDrawOp[] = [
		{
			op: "fill",
			rect: { x: 0, y: 0, w: width, h: height },
			color: "sealedBg",
		},
	];
	const cols = (CHEST_PIXELS[0] as string).length;
	const rows = CHEST_PIXELS.length;
	const cell = Math.max(
		1,
		Math.floor(Math.min(grid.inner.w / cols, grid.inner.h / 2 / rows)),
	);
	const ox = Math.round((width - cols * cell) / 2);
	const captionLines =
		1 +
		(preview.name ? 1 : 0) +
		(preview.bytes !== undefined ? 1 : 0) +
		(preview.reason ? 1 : 0);
	const oy =
		captionLines === 1
			? Math.round(height / 2 - (rows * cell) / 2 - m.fontPx)
			: Math.round(
					(height - rows * cell - captionLines * grid.lineHeight(m.fontPx)) / 2,
				);
	const roles: Record<string, ArchColorRole> = {
		w: "chestWood",
		d: "chestDark",
		g: "chestGold",
	};
	CHEST_PIXELS.forEach((row, ry) => {
		for (let rx = 0; rx < row.length; rx++) {
			const role = roles[row[rx] as string];
			if (role)
				ops.push({
					op: "fill",
					rect: { x: ox + rx * cell, y: oy + ry * cell, w: cell, h: cell },
					color: role,
				});
		}
	});
	const lh = grid.lineHeight(m.fontPx);
	const captions: { text: string; color: ArchColorRole }[] = [
		{ text: "sealed", color: "muted" },
	];
	if (preview.name) captions.push({ text: preview.name, color: "cream" });
	if (preview.bytes !== undefined)
		captions.push({ text: formatBytes(preview.bytes), color: "muted" });
	if (preview.reason)
		captions.push({ text: sealedReasonText(preview.reason), color: "keyword" });
	let y = oy + rows * cell + m.fontPx * 0.6;
	for (const caption of captions) {
		if (y + lh > height) break;
		ops.push(captionOp(caption.text, y, width, grid, m, caption.color));
		y += lh;
	}
	return ops;
}

// --- level of detail ------------------------------------------------------

export interface DetailCandidate {
	id: string;
	pos: Position;
}

/**
 * Which portals get a detailed (per-portal canvas) preview this tick:
 * within `radius` of the player AND overlapping the camera view (padded by
 * `viewPad` so an arch half off-screen still counts), nearest first, capped
 * at `max`. Everything else shows the shared cheap placeholder — so texture
 * memory and canvas work stay bounded no matter how many portals a world has.
 */
export function selectDetailPortals(
	candidates: readonly DetailCandidate[],
	player: Position,
	view: Rect,
	radius: number,
	max: number,
	viewPad = 0,
): string[] {
	const picked: { id: string; d: number }[] = [];
	for (const c of candidates) {
		const d = Math.hypot(c.pos.x - player.x, c.pos.y - player.y);
		if (d > radius) continue;
		if (!isInView(c.pos, view, viewPad)) continue;
		picked.push({ id: c.id, d });
	}
	picked.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
	return picked.slice(0, Math.max(0, max)).map((p) => p.id);
}

/** Portals whose arch overlaps the padded view at all — the rest have their preview image hidden outright. */
export function isInView(pos: Position, view: Rect, pad: number): boolean {
	return (
		pos.x >= view.x - pad &&
		pos.x <= view.x + view.w + pad &&
		pos.y >= view.y - pad &&
		pos.y <= view.y + view.h + pad
	);
}
