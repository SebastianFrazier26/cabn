import { z } from "zod";
import {
	MEDIA_MAX_FILE_BYTES_LIMIT,
	MEDIA_MAX_TOTAL_BYTES_LIMIT,
} from "./media.js";
import {
	HttpsOriginSchema,
	HttpsUrlSchema,
	isAllowedEmbedOrigin,
} from "./shared.js";

/**
 * cabn.json's own format version, independent of CABN_VERSION (the bundle
 * format) — a world source's override file and the bundle the converter
 * produces from it evolve on separate schedules.
 */
export const CABN_CONFIG_VERSION = 1;

// No leading "/", no ".." or "." segments, no backslash — same shape as
// converter's zip-slip guard (sources/zip.ts's sanitizeZipPath), enforced
// again here so a hand-edited cabn.json fails schema validation with a clear
// per-path message before the converter ever tries to resolve it against the
// source. The converter still re-checks against actual source entries
// (belt-and-suspenders: this catches syntactically bad paths, that catches
// paths that don't exist or a source whose entries() has its own quirks).
function isSafeRelativePath(value: string): boolean {
	if (value.startsWith("/") || value.includes("\\")) return false;
	const segments = value.split("/");
	return segments.every((s) => s.length > 0 && s !== "." && s !== "..");
}

const RelativeSourcePathSchema = z.string().refine(isSafeRelativePath, {
	message: 'must be a relative path with no leading "/", "..", or "." segments',
});

export const ImagePreviewOverrideSchema = z.strictObject({
	kind: z.literal("image"),
	/** Path inside the world source, relative to the source root (same root cabn.json itself lives at). */
	src: RelativeSourcePathSchema,
});
export type ImagePreviewOverride = z.infer<typeof ImagePreviewOverrideSchema>;

export const UrlPreviewOverrideSchema = z.strictObject({
	kind: z.literal("url"),
	url: HttpsUrlSchema,
	title: z.string().max(200).optional(),
	fallbackImage: RelativeSourcePathSchema.optional(),
});
export type UrlPreviewOverride = z.infer<typeof UrlPreviewOverrideSchema>;

export const MarkdownPreviewOverrideSchema = z.strictObject({
	kind: z.literal("markdown"),
	src: RelativeSourcePathSchema,
});
export type MarkdownPreviewOverride = z.infer<
	typeof MarkdownPreviewOverrideSchema
>;

export const TextPreviewOverrideSchema = z.strictObject({
	kind: z.literal("text"),
	text: z.string().min(1).max(2000),
});
export type TextPreviewOverride = z.infer<typeof TextPreviewOverrideSchema>;

export const PreviewOverrideSchema = z.discriminatedUnion("kind", [
	ImagePreviewOverrideSchema,
	UrlPreviewOverrideSchema,
	MarkdownPreviewOverrideSchema,
	TextPreviewOverrideSchema,
]);
export type PreviewOverride = z.infer<typeof PreviewOverrideSchema>;

// Optional and additive, so cabnConfigVersion stays 1. A converter from
// before this field rejects a cabn.json that sets it (strictObject) — the
// right failure, since it would otherwise silently ignore the author's caps.
export const MediaCapsConfigSchema = z
	.strictObject({
		/** Per-file media cap in bytes (default DEFAULT_MEDIA_MAX_FILE_BYTES). */
		maxFileBytes: z.number().int().positive().max(MEDIA_MAX_FILE_BYTES_LIMIT),
		/** Whole-world media budget in bytes (default DEFAULT_MEDIA_MAX_TOTAL_BYTES); 0 ships no media at all. */
		maxTotalBytes: z
			.number()
			.int()
			.nonnegative()
			.max(MEDIA_MAX_TOTAL_BYTES_LIMIT),
	})
	.partial();
export type MediaCapsConfig = z.infer<typeof MediaCapsConfigSchema>;

const CabnConfigShapeSchema = z.strictObject({
	cabnConfigVersion: z.literal(CABN_CONFIG_VERSION),
	/** Relative path (from the source root) -> preview override. Leave absent for the converter's default preview. */
	previews: z
		.record(RelativeSourcePathSchema, PreviewOverrideSchema)
		.default({}),
	/** Exact https origins a url-preview's `url` is allowed to come from — see shared.ts's isAllowedEmbedOrigin for the matching rule (no wildcards). */
	allowedEmbedOrigins: z.array(HttpsOriginSchema).default([]),
	/** Caps on image/audio/PDF bytes shipped in the bundle. A host's own ceilings (ConvertOptions.mediaMaxFileBytes/mediaMaxTotalBytes) still win. */
	media: MediaCapsConfigSchema.optional(),
	/** `false` hides the guide NPC (Wren) this world would otherwise show at its bonfire. Absent means "default": the engine shows the guide only in the first world of a shelf (or a world booted on its own). */
	guide: z.boolean().optional(),
	// Room for future per-world options (e.g. a default biome override, a
	// world-level title/description) without another version bump — add them
	// as optional fields here, not by loosening this strictObject.
});

// A url override whose origin isn't allowlisted is a converter validation
// error, not a silent drop — cross-field, so it has to live in superRefine
// rather than on PreviewOverrideSchema itself (which has no access to the
// sibling allowedEmbedOrigins array).
export const CabnConfigSchema = CabnConfigShapeSchema.superRefine(
	(config, ctx) => {
		for (const [path, preview] of Object.entries(config.previews)) {
			if (preview.kind !== "url") continue;
			if (!isAllowedEmbedOrigin(preview.url, config.allowedEmbedOrigins)) {
				ctx.addIssue({
					code: "custom",
					message: `url preview for "${path}" has an origin not listed in allowedEmbedOrigins: ${preview.url}`,
					path: ["previews", path, "url"],
				});
			}
		}
	},
);
export type CabnConfig = z.infer<typeof CabnConfigSchema>;

export class CabnConfigValidationError extends Error {
	constructor(readonly issues: string) {
		super(`Invalid cabn.json:\n${issues}`);
		this.name = "CabnConfigValidationError";
	}
}

export function validateCabnConfig(json: unknown): CabnConfig {
	const result = CabnConfigSchema.safeParse(json);
	if (!result.success) {
		throw new CabnConfigValidationError(z.prettifyError(result.error));
	}
	return result.data;
}
