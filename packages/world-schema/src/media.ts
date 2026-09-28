import { z } from "zod";

/**
 * Media previews (audio, PDF, and the reason a media file stayed sealed) live
 * in a separate `media.json` bundle file, not in world.json's
 * `portal.richPreview`. world.json is parsed with strict schemas by every
 * engine ever shipped — a new richPreview kind (or any new field) there makes
 * an older engine reject the whole world. media.json is a file older engines
 * never request, so they keep working and show those portals as the sealed
 * chest world.json still carries for them. That is why CABN_VERSION did not
 * need a bump for this. The parser below is also deliberately tolerant
 * (unknown kinds are dropped per entry, not a hard failure), so the next new
 * media kind can ship the same way without breaking this engine either.
 */
export const MEDIA_INDEX_VERSION = 1;

export const MEDIA_INDEX_FILENAME = "media.json";

export const DEFAULT_MEDIA_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MEDIA_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
/** Ceilings a cabn.json `media` override can raise the defaults to, never past. */
export const MEDIA_MAX_FILE_BYTES_LIMIT = 25 * 1024 * 1024;
export const MEDIA_MAX_TOTAL_BYTES_LIMIT = 250 * 1024 * 1024;

export const MEDIA_FORMATS = [
	"png",
	"jpeg",
	"gif",
	"webp",
	"mp3",
	"wav",
	"ogg",
	"pdf",
] as const;
export const MediaFormatSchema = z.enum(MEDIA_FORMATS);
export type MediaFormat = z.infer<typeof MediaFormatSchema>;

export const AUDIO_FORMATS = ["mp3", "wav", "ogg"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** Bundle file extension per sniffed format — derived from the bytes, never copied from the source filename, so a static host's extension-based content-type always matches what the file really is. */
export const MEDIA_FORMAT_EXTENSION: Record<MediaFormat, string> = {
	png: "png",
	jpeg: "jpg",
	gif: "gif",
	webp: "webp",
	mp3: "mp3",
	wav: "wav",
	ogg: "ogg",
	pdf: "pdf",
};

// Pinned to exactly what the converter writes (media/<16 hex>.<known ext>).
// An arbitrary string here would let a hand-edited bundle point the engine's
// fetch/pdf.js/audio loaders at another origin ("//host/x" is absolute to
// resolveRelativeUrl) or up out of the bundle directory.
export const MEDIA_ASSET_PATTERN =
	/^media\/[0-9a-f]{16}\.(png|jpg|gif|webp|mp3|wav|ogg|pdf)$/;
export const MediaAssetPathSchema = z.string().regex(MEDIA_ASSET_PATTERN);

export const AudioPreviewSchema = z.strictObject({
	kind: z.literal("audio"),
	asset: MediaAssetPathSchema,
	bytes: z.number().int().nonnegative(),
	format: z.enum(AUDIO_FORMATS),
});
export type AudioPreview = z.infer<typeof AudioPreviewSchema>;

export const PdfPreviewSchema = z.strictObject({
	kind: z.literal("pdf"),
	asset: MediaAssetPathSchema,
	bytes: z.number().int().nonnegative(),
});
export type PdfPreview = z.infer<typeof PdfPreviewSchema>;

export const MEDIA_SEALED_REASONS = [
	/** Over the per-file media cap. */
	"too-large",
	/** Under the per-file cap, but the world's total media budget was already spent. */
	"budget",
	/** Extension claims a media type the bytes don't match (or no known signature at all). */
	"type-mismatch",
	/** A recognizable format cabn deliberately doesn't preview (SVG, xlsx, ...). */
	"unsupported",
	/** Secret-patterned or otherwise never read. */
	"unread",
] as const;
export const MediaSealedReasonSchema = z.enum(MEDIA_SEALED_REASONS);
export type MediaSealedReason = z.infer<typeof MediaSealedReasonSchema>;

export const MediaSealedPreviewSchema = z.strictObject({
	kind: z.literal("sealed"),
	reason: MediaSealedReasonSchema,
});
export type MediaSealedPreview = z.infer<typeof MediaSealedPreviewSchema>;

export const MediaPreviewSchema = z.discriminatedUnion("kind", [
	AudioPreviewSchema,
	PdfPreviewSchema,
	MediaSealedPreviewSchema,
]);
export type MediaPreview = z.infer<typeof MediaPreviewSchema>;

export const MediaIndexFileSchema = z.strictObject({
	mediaVersion: z.literal(MEDIA_INDEX_VERSION),
	/** Portal id -> media preview. Takes precedence over that portal's world.json richPreview in engines that understand it. */
	previews: z.record(z.string(), MediaPreviewSchema),
	totalBytes: z.number().int().nonnegative(),
});
export type MediaIndexFile = z.infer<typeof MediaIndexFileSchema>;

const LooseMediaIndexSchema = z.object({
	mediaVersion: z.number(),
	previews: z.record(z.string(), z.unknown()),
});

/**
 * Engine-side reader: never throws. A missing/garbled file, a future
 * mediaVersion, or an entry of a kind this build doesn't know all degrade to
 * "no media preview" for the affected portals, which then fall back to
 * whatever world.json says (a sealed chest).
 */
export function parseMediaIndex(json: unknown): Map<string, MediaPreview> {
	const out = new Map<string, MediaPreview>();
	const loose = LooseMediaIndexSchema.safeParse(json);
	if (!loose.success || loose.data.mediaVersion !== MEDIA_INDEX_VERSION)
		return out;
	for (const [portalId, raw] of Object.entries(loose.data.previews)) {
		const entry = MediaPreviewSchema.safeParse(raw);
		if (entry.success) out.set(portalId, entry.data);
	}
	return out;
}
