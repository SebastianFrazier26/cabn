import { z } from "zod";
import { HistoryConfigSchema } from "./history.js";
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

// Bounds keep a hand-edited value from turning every function into a bramble
// (or none ever). The thresholds are also written into each CodeSmell rule
// string, which is how the engine's post-edit re-check recovers them.
export const DEFAULT_MAX_FUNCTION_LINES = 80;
export const DEFAULT_MAX_NESTING_DEPTH = 4;

export const AnnotateConfigSchema = z
	.strictObject({
		/** A function spanning more lines than this is a CodeSmell (default DEFAULT_MAX_FUNCTION_LINES). */
		maxFunctionLines: z.number().int().min(10).max(2000),
		/** Control-flow nesting deeper than this inside one function is a CodeSmell (default DEFAULT_MAX_NESTING_DEPTH). */
		maxNestingDepth: z.number().int().min(2).max(20),
	})
	.partial();
export type AnnotateConfig = z.infer<typeof AnnotateConfigSchema>;

export const WORLD_LINKS_MAX = 8;
export const WORLD_DESCRIPTION_MAX_CHARS = 500;

export const WorldLinkSchema = z.strictObject({
	label: z.string().min(1).max(60),
	url: HttpsUrlSchema,
});
export type WorldLink = z.infer<typeof WorldLinkSchema>;

/** World-level metadata a host (e.g. a portfolio shelf) shows about a world. Carried into the bundle's showcase.json and the shelf entry, never world.json. */
export const WorldInfoConfigSchema = z.strictObject({
	title: z.string().min(1).max(200).optional(),
	description: z.string().max(WORLD_DESCRIPTION_MAX_CHARS).optional(),
	links: z.array(WorldLinkSchema).max(WORLD_LINKS_MAX).optional(),
	/** Shelf sort key: lower first; worlds without one follow, by name. */
	order: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});
export type WorldInfoConfig = z.infer<typeof WorldInfoConfigSchema>;

export const SITES_MAX = 8;

/** Ids become part of a portal id ("@cabn-site/<id>"), so they stay slug-shaped. */
export const SiteIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, {
	message:
		"must be 1-40 chars of a-z, 0-9 and -, starting with a letter or digit",
});

export const SiteConfigSchema = z.strictObject({
	id: SiteIdSchema,
	title: z.string().min(1).max(200),
	url: HttpsUrlSchema,
	fallbackImage: RelativeSourcePathSchema.optional(),
	/** At most one per world: placed beside the spawn bonfire, emphasized, and the first live page a visitor sees. */
	hero: z.boolean().optional(),
});
export type SiteConfig = z.infer<typeof SiteConfigSchema>;

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
	/** Thresholds for the code-smell annotator. Optional and additive, same as `media`. */
	annotate: AnnotateConfigSchema.optional(),
	/** false skips the converter's build-time framability check (no network request to any url preview); every url preview is then assumed framable. Optional and additive, same compat note as `media`. */
	embedCheck: z.boolean().optional(),
	/** Git history, alternate-branch universes and GitHub releases (see history.ts). Optional and additive, same compat note as `media`. */
	history: HistoryConfigSchema.optional(),
	/** World-level title/description/links/shelf order. Optional and additive, same compat note as `media`. */
	world: WorldInfoConfigSchema.optional(),
	/** Web portals not backed by any file in the source (a project's live site or demo). Optional and additive, same compat note as `media`. */
	sites: z.array(SiteConfigSchema).max(SITES_MAX).optional(),
	// Room for future per-world options (e.g. a default biome override)
	// without another version bump — add them as optional fields here, not by
	// loosening this strictObject.
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
		const siteIds = new Set<string>();
		let heroes = 0;
		for (const [index, site] of (config.sites ?? []).entries()) {
			if (siteIds.has(site.id)) {
				ctx.addIssue({
					code: "custom",
					message: `duplicate site id "${site.id}"`,
					path: ["sites", index, "id"],
				});
			}
			siteIds.add(site.id);
			if (site.hero) heroes++;
			if (!isAllowedEmbedOrigin(site.url, config.allowedEmbedOrigins)) {
				ctx.addIssue({
					code: "custom",
					message: `site "${site.id}" has an origin not listed in allowedEmbedOrigins: ${site.url}`,
					path: ["sites", index, "url"],
				});
			}
		}
		if (heroes > 1) {
			ctx.addIssue({
				code: "custom",
				message: `at most one site can be the hero (found ${heroes})`,
				path: ["sites"],
			});
		}
	},
);
export type CabnConfig = z.infer<typeof CabnConfigSchema>;
/** What a hand-written cabn.json (or an injected config) looks like before defaults are applied. */
export type CabnConfigInput = z.input<typeof CabnConfigSchema>;

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
