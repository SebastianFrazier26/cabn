import { describe, expect, test } from "vitest";
import { sniffImageDimensions } from "../src/imageDimensions.js";

// These builders produce the minimum bytes sniffImageDimensions actually
// reads (signature + dimension fields) — not full, checksum-valid images.
// The sniffer never verifies CRCs/pixel data, so a "fake" header is enough to
// exercise it without shipping real binary fixtures.

function buildPng(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13); // IHDR chunk length (unread by the sniffer, but realistic)
	bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

function buildJpegSof0(width: number, height: number): Uint8Array {
	// SOI, then an SOF0 segment: marker(2) length(2) precision(1) height(2) width(2).
	const bytes = new Uint8Array(2 + 2 + 2 + 1 + 2 + 2);
	bytes.set([0xff, 0xd8], 0);
	bytes.set([0xff, 0xc0], 2);
	const view = new DataView(bytes.buffer);
	view.setUint16(4, 7); // segment length (precision+height+width, not counting the marker)
	bytes[6] = 8; // precision
	view.setUint16(7, height);
	view.setUint16(9, width);
	return bytes;
}

function buildJpegWithPrefixSegment(width: number, height: number): Uint8Array {
	// SOI, an APP0/JFIF-shaped filler segment, then SOF0 — exercises marker-walking.
	const filler = new Uint8Array(2 + 2 + 4); // marker(2) + length(2) + 4 payload bytes
	filler.set([0xff, 0xe0], 0);
	new DataView(filler.buffer).setUint16(2, 6); // length covers itself + the 4 payload bytes
	const sofWithoutSoi = buildJpegSof0(width, height).subarray(2);
	const bytes = new Uint8Array(2 + filler.length + sofWithoutSoi.length);
	bytes.set([0xff, 0xd8], 0);
	bytes.set(filler, 2);
	bytes.set(sofWithoutSoi, 2 + filler.length);
	return bytes;
}

function buildGif(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(10);
	bytes.set(new TextEncoder().encode("GIF89a"), 0);
	new DataView(bytes.buffer).setUint16(6, width, true);
	new DataView(bytes.buffer).setUint16(8, height, true);
	return bytes;
}

function buildWebpVp8x(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(30);
	bytes.set(new TextEncoder().encode("RIFF"), 0);
	bytes.set(new TextEncoder().encode("WEBP"), 8);
	bytes.set(new TextEncoder().encode("VP8X"), 12);
	const w = width - 1;
	const h = height - 1;
	bytes[24] = w & 0xff;
	bytes[25] = (w >> 8) & 0xff;
	bytes[26] = (w >> 16) & 0xff;
	bytes[27] = h & 0xff;
	bytes[28] = (h >> 8) & 0xff;
	bytes[29] = (h >> 16) & 0xff;
	return bytes;
}

describe("sniffImageDimensions", () => {
	test("reads PNG IHDR width/height", () => {
		expect(sniffImageDimensions(buildPng(64, 32))).toEqual({
			width: 64,
			height: 32,
		});
	});

	test("reads JPEG SOF0 width/height", () => {
		expect(sniffImageDimensions(buildJpegSof0(100, 200))).toEqual({
			width: 100,
			height: 200,
		});
	});

	test("walks past a leading marker segment to find SOF0", () => {
		expect(sniffImageDimensions(buildJpegWithPrefixSegment(50, 75))).toEqual({
			width: 50,
			height: 75,
		});
	});

	test("reads GIF logical screen width/height", () => {
		expect(sniffImageDimensions(buildGif(320, 240))).toEqual({
			width: 320,
			height: 240,
		});
	});

	test("reads WEBP VP8X extended-header width/height", () => {
		expect(sniffImageDimensions(buildWebpVp8x(800, 600))).toEqual({
			width: 800,
			height: 600,
		});
	});

	test("returns undefined for an unrecognized format", () => {
		expect(
			sniffImageDimensions(new TextEncoder().encode("not an image")),
		).toBeUndefined();
	});

	test("returns undefined rather than throwing on truncated bytes", () => {
		expect(sniffImageDimensions(new Uint8Array([0x89, 0x50]))).toBeUndefined();
	});
});
