import { z } from "zod";
import { HttpsUrlSchema } from "./shared.js";

/**
 * Build-time framability results for url previews live in their own
 * `embeds.json` bundle file, for the same reason media previews live in
 * media.json (see media.ts): world.json is parsed with strict schemas by
 * every engine ever shipped, so a new field on `richPreview` would make an
 * older engine reject the whole world. Older engines never request this
 * file and keep trying the iframe (and falling back on their load timeout),
 * exactly as before. CABN_VERSION is unchanged. The engine-side parser is
 * tolerant per entry so a future field or basis can ship the same way.
 */
export const EMBED_INDEX_VERSION = 1;

export const EMBED_INDEX_FILENAME = "embeds.json";

export const EMBED_CHECK_BASES = [
	/** X-Frame-Options / CSP frame-ancestors were read from the site's response. */
	"headers",
	/** No request was made (offline build, host-disabled, or cabn.json opt-out) — assumed framable. */
	"offline",
	/** A request was attempted but gave no usable answer (timeout, network error, non-https redirect, too many redirects) — assumed framable. */
	"unreachable",
] as const;
export const EmbedCheckBasisSchema = z.enum(EMBED_CHECK_BASES);
export type EmbedCheckBasis = z.infer<typeof EmbedCheckBasisSchema>;

export const EMBED_DETAIL_MAX_CHARS = 300;

export const EmbedCheckEntrySchema = z.strictObject({
	/** The url that was checked — the engine applies the entry only while the portal's url still matches it. */
	url: HttpsUrlSchema,
	framable: z.boolean(),
	basis: EmbedCheckBasisSchema,
	/** Human-readable why, e.g. "X-Frame-Options: deny". */
	detail: z.string().max(EMBED_DETAIL_MAX_CHARS).optional(),
});
export type EmbedCheckEntry = z.infer<typeof EmbedCheckEntrySchema>;

export const EMBED_CHECK_MODES = ["network", "offline"] as const;

export const EmbedIndexFileSchema = z.strictObject({
	embedsVersion: z.literal(EMBED_INDEX_VERSION),
	mode: z.enum(EMBED_CHECK_MODES),
	/** Portal id -> result, for every url preview in the world. */
	entries: z.record(z.string(), EmbedCheckEntrySchema),
});
export type EmbedIndexFile = z.infer<typeof EmbedIndexFileSchema>;

const LooseEmbedIndexSchema = z.object({
	embedsVersion: z.number(),
	entries: z.record(z.string(), z.unknown()),
});

// Loose per entry (unknown keys stripped, not rejected) so a later converter
// can add fields without this engine dropping the verdict.
const LooseEmbedEntrySchema = z.object({
	url: HttpsUrlSchema,
	framable: z.boolean(),
	basis: z.string(),
	detail: z.string().max(EMBED_DETAIL_MAX_CHARS).optional(),
});

export interface EmbedVerdict {
	url: string;
	framable: boolean;
	detail?: string;
}

/**
 * Engine-side reader: never throws. A missing/garbled file, a future
 * embedsVersion, or a malformed entry all degrade to "no verdict", which the
 * engine treats as framable (try the iframe, keep the load-timeout fallback).
 */
export function parseEmbedIndex(json: unknown): Map<string, EmbedVerdict> {
	const out = new Map<string, EmbedVerdict>();
	const loose = LooseEmbedIndexSchema.safeParse(json);
	if (!loose.success || loose.data.embedsVersion !== EMBED_INDEX_VERSION)
		return out;
	for (const [portalId, raw] of Object.entries(loose.data.entries)) {
		const entry = LooseEmbedEntrySchema.safeParse(raw);
		if (!entry.success) continue;
		out.set(portalId, {
			url: entry.data.url,
			framable: entry.data.framable,
			...(entry.data.detail !== undefined ? { detail: entry.data.detail } : {}),
		});
	}
	return out;
}
