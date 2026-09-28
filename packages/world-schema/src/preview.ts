import { z } from "zod";
import { HttpsUrlSchema } from "./shared.js";

// Bumped from the M1-era 12 lines / 120 chars / 512 bytes: those caps were
// sized for a small floating in-world panel (see engine's previewText.ts,
// which re-clamps further for that display). This is the bundle-wide default
// "literal preview" payload — PortalPreview/PortalEmbed render it full-size
// in an expanded view too, so it can afford to carry more before the engine
// clamps it down for whichever surface is showing it.
export const CODE_PREVIEW_MAX_LINES = 40;
export const CODE_PREVIEW_MAX_LINE_CHARS = 200;
export const CODE_PREVIEW_MAX_TOTAL_BYTES = 4096;

export const CodePreviewSchema = z.strictObject({
	kind: z.literal("code"),
	lines: z
		.array(z.string().max(CODE_PREVIEW_MAX_LINE_CHARS))
		.max(CODE_PREVIEW_MAX_LINES),
	/** Language id for syntax colouring (CodeMirror's existing lang list — see engine/react/editorLanguages.ts); absent for extensionless/unknown files. */
	language: z.string().optional(),
	truncated: z.boolean(),
});
export type CodePreview = z.infer<typeof CodePreviewSchema>;

// Structured, not HTML: PortalPreview renders these nodes itself rather than
// dangerouslySetInnerHTML-ing parsed markdown, so a malicious README can't
// inject a script tag into the world UI.
export const MARKDOWN_PREVIEW_MAX_NODES = 24;
export const MARKDOWN_PREVIEW_MAX_TEXT_CHARS = 400;
export const MARKDOWN_PREVIEW_MAX_LIST_ITEMS = 20;

export const MarkdownPreviewNodeSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("heading"),
		level: z.number().int().min(1).max(6),
		text: z.string().max(MARKDOWN_PREVIEW_MAX_TEXT_CHARS),
	}),
	z.strictObject({
		type: z.literal("paragraph"),
		text: z.string().max(MARKDOWN_PREVIEW_MAX_TEXT_CHARS),
	}),
	z.strictObject({
		type: z.literal("list"),
		ordered: z.boolean(),
		items: z
			.array(z.string().max(MARKDOWN_PREVIEW_MAX_TEXT_CHARS))
			.max(MARKDOWN_PREVIEW_MAX_LIST_ITEMS),
	}),
	z.strictObject({
		type: z.literal("code"),
		language: z.string().optional(),
		text: z.string().max(MARKDOWN_PREVIEW_MAX_TEXT_CHARS),
	}),
]);
export type MarkdownPreviewNode = z.infer<typeof MarkdownPreviewNodeSchema>;

export const MarkdownPreviewSchema = z.strictObject({
	kind: z.literal("markdown"),
	nodes: z.array(MarkdownPreviewNodeSchema).max(MARKDOWN_PREVIEW_MAX_NODES),
	truncated: z.boolean(),
});
export type MarkdownPreview = z.infer<typeof MarkdownPreviewSchema>;

export const ImagePreviewSchema = z.strictObject({
	kind: z.literal("image"),
	/** Bundle-relative path (e.g. "assets/previews/<hash>.png"), resolved the same way chunk/world URLs are (see engine's resolveRelativeUrl). */
	asset: z.string().min(1),
	bytes: z.number().int().nonnegative(),
	/** Best-effort, pure-header-sniffed pixel dimensions — absent for formats/files the sniffer doesn't recognize (see converter's imageDimensions.ts). Not a resized thumbnail; see README for why. */
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
});
export type ImagePreview = z.infer<typeof ImagePreviewSchema>;

const TEXT_PREVIEW_MAX_CHARS = 2000;

export const TextPreviewSchema = z.strictObject({
	kind: z.literal("text"),
	text: z.string().max(TEXT_PREVIEW_MAX_CHARS),
});
export type TextPreview = z.infer<typeof TextPreviewSchema>;

export const UrlPreviewSchema = z.strictObject({
	kind: z.literal("url"),
	url: HttpsUrlSchema,
	title: z.string().max(200).optional(),
	/** Bundle-relative path, same convention as ImagePreview.asset — shown if the live iframe fails/times out. */
	fallbackImage: z.string().min(1).optional(),
});
export type UrlPreview = z.infer<typeof UrlPreviewSchema>;

// Binary files with no cabn.json override: the "sealed chest" — deliberately
// no content of any kind (not even a byte count here; PortalFile already
// carries bytes/binary for that).
export const SealedPreviewSchema = z.strictObject({
	kind: z.literal("sealed"),
});
export type SealedPreview = z.infer<typeof SealedPreviewSchema>;

// Named "Rich*" (not "PortalPreview*") to avoid colliding with manifest.ts's
// existing PortalPreviewSchema — the small {lines,truncated} shape WorldScene
// still reads for its in-arch panel — and to make clear this is the new,
// separate `portal.richPreview` field, not a replacement for it.
export const RichPortalPreviewSchema = z.discriminatedUnion("kind", [
	CodePreviewSchema,
	MarkdownPreviewSchema,
	ImagePreviewSchema,
	TextPreviewSchema,
	UrlPreviewSchema,
	SealedPreviewSchema,
]);
export type RichPortalPreview = z.infer<typeof RichPortalPreviewSchema>;
