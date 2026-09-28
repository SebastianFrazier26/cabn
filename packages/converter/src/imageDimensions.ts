/**
 * Best-effort, pure-header-sniffed pixel dimensions for the four raster
 * formats classify.ts already recognizes as "image" that have simple,
 * fixed-offset dimension fields (PNG/JPEG/GIF/WEBP-VP8). Deliberately not a
 * full image decoder — this package must stay browser-safe/dependency-free
 * (see README: real thumbnailing needs a native library like sharp and lives
 * in tools/asset-pipeline, not here). SVG has no fixed pixel size at all
 * (viewBox/width attrs can be absent, relative, or percentages) so it's
 * intentionally not attempted; BMP/ICO are rare enough in source repos that
 * they're not worth the extra parsers. Returns undefined for anything it
 * doesn't recognize or that's truncated/corrupt — callers treat that as "no
 * dimensions available", never as an error.
 */
export interface ImageDimensions {
	width: number;
	height: number;
}

// Callers always bounds-check before calling these, but that's a length
// comparison a few lines away that TS can't see through — `?? 0` documents
// "always in range in practice" without a noNonNullAssertion escape hatch.
function byteAt(bytes: Uint8Array, offset: number): number {
	return bytes[offset] ?? 0;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
	return (
		(byteAt(bytes, offset) << 24) |
		(byteAt(bytes, offset + 1) << 16) |
		(byteAt(bytes, offset + 2) << 8) |
		byteAt(bytes, offset + 3)
	);
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
	return (byteAt(bytes, offset) << 8) | byteAt(bytes, offset + 1);
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
	return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffPng(bytes: Uint8Array): ImageDimensions | undefined {
	if (bytes.length < 24) return undefined;
	if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return undefined;
	// IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte
	// "IHDR" type, then 4-byte width + 4-byte height, all big-endian.
	if (
		bytes[12] !== 0x49 ||
		bytes[13] !== 0x48 ||
		bytes[14] !== 0x44 ||
		bytes[15] !== 0x52
	) {
		return undefined;
	}
	return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
}

// SOF markers that carry frame dimensions — excludes 0xC4 (DHT), 0xC8 (JPG
// extension, unused), and 0xCC (DAC), which share the 0xC0-0xCF range but
// aren't start-of-frame segments.
const JPEG_SOF_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function sniffJpeg(bytes: Uint8Array): ImageDimensions | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		return undefined;
	}
	let offset = 2;
	// Need indices up through offset+8 (width's high byte) to be in range for
	// an SOF segment read below.
	while (offset + 9 <= bytes.length) {
		if (bytes[offset] !== 0xff) return undefined; // not a well-formed marker sequence
		const marker = byteAt(bytes, offset + 1);
		if (marker === 0xd8 || marker === 0xd9) {
			offset += 2; // SOI/EOI carry no length field
			continue;
		}
		const segmentLength = readUInt16BE(bytes, offset + 2);
		if (JPEG_SOF_MARKERS.has(marker)) {
			return {
				height: readUInt16BE(bytes, offset + 5),
				width: readUInt16BE(bytes, offset + 7),
			};
		}
		offset += 2 + segmentLength;
	}
	return undefined;
}

function sniffGif(bytes: Uint8Array): ImageDimensions | undefined {
	if (bytes.length < 10) return undefined;
	const header = String.fromCharCode(...bytes.subarray(0, 6));
	if (header !== "GIF87a" && header !== "GIF89a") return undefined;
	return { width: readUInt16LE(bytes, 6), height: readUInt16LE(bytes, 8) };
}

function sniffWebp(bytes: Uint8Array): ImageDimensions | undefined {
	if (bytes.length < 30) return undefined;
	const isRiff =
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46;
	const isWebp =
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50;
	if (!isRiff || !isWebp) return undefined;

	const fourCc = String.fromCharCode(...bytes.subarray(12, 16));
	if (fourCc === "VP8X") {
		// 24-bit little-endian width-1/height-1 at a fixed offset in the extended header.
		const width =
			(byteAt(bytes, 24) |
				(byteAt(bytes, 25) << 8) |
				(byteAt(bytes, 26) << 16)) +
			1;
		const height =
			(byteAt(bytes, 27) |
				(byteAt(bytes, 28) << 8) |
				(byteAt(bytes, 29) << 16)) +
			1;
		return { width, height };
	}
	if (fourCc === "VP8 ") {
		// Lossy WebP: 14-bit width/height (top 2 bits are scale flags) after a 3-byte start code.
		const width = readUInt16LE(bytes, 26) & 0x3fff;
		const height = readUInt16LE(bytes, 28) & 0x3fff;
		return { width, height };
	}
	// VP8L (lossless) uses a bit-packed 14-bit header, not byte-aligned — not
	// worth a bit-reader for a best-effort sniffer.
	return undefined;
}

export function sniffImageDimensions(
	bytes: Uint8Array,
): ImageDimensions | undefined {
	return (
		sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes)
	);
}
