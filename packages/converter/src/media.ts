import {
	type CabnConfig,
	DEFAULT_MEDIA_MAX_FILE_BYTES,
	DEFAULT_MEDIA_MAX_TOTAL_BYTES,
	MEDIA_FORMAT_EXTENSION,
	type MediaFormat,
	type MediaSealedReason,
} from "@cabn/world-schema";

function startsWith(
	bytes: Uint8Array,
	sig: readonly number[],
	at = 0,
): boolean {
	if (bytes.length < at + sig.length) return false;
	for (let i = 0; i < sig.length; i++)
		if (bytes[at + i] !== sig[i]) return false;
	return true;
}

function ascii(s: string): number[] {
	return [...s].map((c) => c.charCodeAt(0));
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = ascii("RIFF");
const PDF_SIG = ascii("%PDF-");
// The PDF spec tolerates junk before the header; readers (pdf.js included)
// scan the first KiB for it, so the sniffer does too.
const PDF_HEADER_WINDOW = 1024;

function isMp3FrameSync(bytes: Uint8Array): boolean {
	const b0 = bytes[0] ?? 0;
	const b1 = bytes[1] ?? 0;
	const layerBits = (b1 >> 1) & 0b11;
	const versionBits = (b1 >> 3) & 0b11;
	// 11 sync bits, then a non-reserved MPEG version and layer.
	return (
		b0 === 0xff && (b1 & 0xe0) === 0xe0 && layerBits !== 0 && versionBits !== 1
	);
}

/**
 * Identifies a media file purely from its leading bytes. Undefined means
 * "none of the formats cabn previews" — the caller seals the file rather than
 * trusting its extension. SVG is deliberately absent: it is a script-capable
 * document, and a bundle served from the host app's own origin would let
 * anyone who opens media/<hash>.svg directly run that script there.
 */
export function sniffMediaFormat(bytes: Uint8Array): MediaFormat | undefined {
	if (startsWith(bytes, PNG_SIG)) return "png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
	if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a")))
		return "gif";
	if (startsWith(bytes, RIFF) && startsWith(bytes, ascii("WEBP"), 8))
		return "webp";
	if (startsWith(bytes, RIFF) && startsWith(bytes, ascii("WAVE"), 8))
		return "wav";
	if (startsWith(bytes, ascii("OggS"))) return "ogg";
	if (startsWith(bytes, ascii("ID3")) || isMp3FrameSync(bytes)) return "mp3";
	const window = Math.min(bytes.length, PDF_HEADER_WINDOW);
	for (let i = 0; i + PDF_SIG.length <= window; i++) {
		if (startsWith(bytes, PDF_SIG, i)) return "pdf";
	}
	return undefined;
}

const EXTENSION_FORMAT: Record<string, MediaFormat> = {
	png: "png",
	jpg: "jpeg",
	jpeg: "jpeg",
	gif: "gif",
	webp: "webp",
	mp3: "mp3",
	wav: "wav",
	ogg: "ogg",
	oga: "ogg",
	pdf: "pdf",
};

/** Extensions cabn recognizes as media but never previews — sealed with reason "unsupported" rather than "type-mismatch". */
const UNSUPPORTED_MEDIA_EXTENSIONS = new Set([
	"svg",
	"xlsx",
	"xls",
	"ico",
	"bmp",
]);

function extensionOf(path: string): string | undefined {
	const name = path.split("/").pop() ?? path;
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

/** The media format a path's extension claims, or undefined if it isn't a media extension at all. */
export function mediaFormatForPath(path: string): MediaFormat | undefined {
	const ext = extensionOf(path);
	return ext ? EXTENSION_FORMAT[ext] : undefined;
}

export function isUnsupportedMediaPath(path: string): boolean {
	const ext = extensionOf(path);
	return ext !== undefined && UNSUPPORTED_MEDIA_EXTENSIONS.has(ext);
}

export function isImageFormat(
	format: MediaFormat,
): format is "png" | "jpeg" | "gif" | "webp" {
	return (
		format === "png" ||
		format === "jpeg" ||
		format === "gif" ||
		format === "webp"
	);
}

// 64 bits from two independently-seeded FNV-1a lanes over the raw bytes —
// content-addressed so identical files dedupe to one bundle entry (and are
// charged to the budget once). Not cryptographic; nothing trusts it as such.
export function mediaContentHash(bytes: Uint8Array): string {
	let a = 0x811c9dc5;
	let b = 0x01000193 ^ bytes.length;
	for (let i = 0; i < bytes.length; i++) {
		const v = bytes[i] as number;
		a = Math.imul(a ^ v, 0x01000193);
		b = Math.imul(b ^ v, 0x5bd1e995);
		b ^= b >>> 15;
	}
	const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
	return `${hex(a)}${hex(b)}`;
}

export function mediaAssetPath(bytes: Uint8Array, format: MediaFormat): string {
	return `media/${mediaContentHash(bytes)}.${MEDIA_FORMAT_EXTENSION[format]}`;
}

export interface MediaCaps {
	maxFileBytes: number;
	maxTotalBytes: number;
}

export interface MediaCapCeilings {
	/** Host policy (e.g. the backend's upload limits) — cabn.json can lower caps below these, never raise past them. */
	maxFileBytes?: number;
	maxTotalBytes?: number;
}

export function resolveMediaCaps(
	config: CabnConfig | undefined,
	ceilings: MediaCapCeilings = {},
): MediaCaps {
	const file = config?.media?.maxFileBytes ?? DEFAULT_MEDIA_MAX_FILE_BYTES;
	const total = config?.media?.maxTotalBytes ?? DEFAULT_MEDIA_MAX_TOTAL_BYTES;
	return {
		maxFileBytes: Math.min(
			file,
			ceilings.maxFileBytes ?? Number.POSITIVE_INFINITY,
		),
		maxTotalBytes: Math.min(
			total,
			ceilings.maxTotalBytes ?? Number.POSITIVE_INFINITY,
		),
	};
}

export type MediaAdmission =
	| { ok: true; format: MediaFormat; assetPath: string }
	| { ok: false; reason: MediaSealedReason };

/**
 * One per conversion: decides, file by file in walk order (sorted, so the
 * outcome is deterministic), whether a media file's bytes ship. Every
 * admitted asset is charged against maxTotalBytes exactly once, even when
 * several portals reference identical bytes.
 */
export class MediaBudget {
	private spent = 0;
	private readonly admitted = new Map<string, Uint8Array>();

	constructor(readonly caps: MediaCaps) {}

	/** Pre-read gate on the declared size, so an over-cap file is never read into memory at all. */
	fitsFileCap(bytes: number): boolean {
		return bytes <= this.caps.maxFileBytes;
	}

	admit(
		claimed: MediaFormat,
		bytes: Uint8Array,
		options: { exactFormat?: boolean } = {},
	): MediaAdmission {
		if (!this.fitsFileCap(bytes.length))
			return { ok: false, reason: "too-large" };
		const sniffed = sniffMediaFormat(bytes);
		const matches =
			sniffed !== undefined &&
			(options.exactFormat === false
				? isImageFormat(sniffed) === isImageFormat(claimed)
				: sniffed === claimed);
		if (!sniffed || !matches) return { ok: false, reason: "type-mismatch" };
		const assetPath = mediaAssetPath(bytes, sniffed);
		if (!this.admitted.has(assetPath)) {
			if (this.spent + bytes.length > this.caps.maxTotalBytes)
				return { ok: false, reason: "budget" };
			this.spent += bytes.length;
			this.admitted.set(assetPath, bytes);
		}
		return { ok: true, format: sniffed, assetPath };
	}

	get totalBytes(): number {
		return this.spent;
	}

	assets(): IterableIterator<[string, Uint8Array]> {
		return this.admitted.entries();
	}
}
