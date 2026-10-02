import { zlibSync } from "fflate";

/**
 * A minimal git packfile (v2, whole objects, no deltas) and its v2 index,
 * written from scratch rather than through isomorphic-git's packObjects/
 * indexPack: those read and write through a file system, and `cabn serve`
 * builds the pack in memory. Browser-safe: SHA-1 comes from WebCrypto.
 */

export type GitObjectType = "commit" | "tree" | "blob" | "tag";

const TYPE_CODE: Record<GitObjectType, number> = {
	commit: 1,
	tree: 2,
	blob: 3,
	tag: 4,
};

export interface PackEntry {
	oid: string;
	/** The object's header + zlib body exactly as it sits in the pack. */
	bytes: Uint8Array;
	crc: number;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++)
		c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-1",
		bytes as Uint8Array<ArrayBuffer>,
	);
	return new Uint8Array(digest);
}

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

function hexBytes(oid: string): Uint8Array {
	const out = new Uint8Array(20);
	for (let i = 0; i < 20; i++)
		out[i] = Number.parseInt(oid.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/** One pack entry: the type/size varint header, then the zlib-deflated object content (no git "type size\0" prefix — the header carries that). */
export function packEntry(
	oid: string,
	type: GitObjectType,
	content: Uint8Array,
): PackEntry {
	const header: number[] = [];
	let size = content.length;
	let byte = (TYPE_CODE[type] << 4) | (size & 0x0f);
	size = Math.floor(size / 16);
	while (size > 0) {
		header.push(byte | 0x80);
		byte = size & 0x7f;
		size = Math.floor(size / 128);
	}
	header.push(byte);
	const body = zlibSync(content);
	const bytes = new Uint8Array(header.length + body.length);
	bytes.set(header, 0);
	bytes.set(body, header.length);
	return { oid, bytes, crc: crc32(bytes) };
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

export function packSize(entries: readonly PackEntry[]): number {
	return 12 + 20 + entries.reduce((n, e) => n + e.bytes.length, 0);
}

export interface WrittenPack {
	/** Hex SHA-1 of the pack contents — git names both files after it. */
	name: string;
	pack: Uint8Array;
	index: Uint8Array;
}

export async function writePack(
	entries: readonly PackEntry[],
): Promise<WrittenPack> {
	const header = new Uint8Array(12);
	header.set([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2]);
	new DataView(header.buffer).setUint32(8, entries.length);
	const offsets = new Map<string, number>();
	let offset = 12;
	for (const e of entries) {
		offsets.set(e.oid, offset);
		offset += e.bytes.length;
	}
	// A v2 index stores 31-bit offsets without the large-offset table this writer omits.
	if (offset >= 0x80000000)
		throw new Error("pack too large for a v2 index without large offsets");
	const body = concat([header, ...entries.map((e) => e.bytes)], offset);
	const packSha = await sha1(body);
	const pack = concat([body, packSha], body.length + 20);

	const sorted = [...entries].sort((a, b) =>
		a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0,
	);
	const n = sorted.length;
	const idxBody = new Uint8Array(8 + 256 * 4 + n * 20 + n * 4 + n * 4 + 20);
	const view = new DataView(idxBody.buffer);
	idxBody.set([0xff, 0x74, 0x4f, 0x63, 0, 0, 0, 2]);
	const fanout = new Uint32Array(256);
	for (const e of sorted)
		fanout[Number.parseInt(e.oid.slice(0, 2), 16)] =
			(fanout[Number.parseInt(e.oid.slice(0, 2), 16)] as number) + 1;
	let running = 0;
	for (let i = 0; i < 256; i++) {
		running += fanout[i] as number;
		view.setUint32(8 + i * 4, running);
	}
	let at = 8 + 256 * 4;
	for (const e of sorted) {
		idxBody.set(hexBytes(e.oid), at);
		at += 20;
	}
	for (const e of sorted) {
		view.setUint32(at, e.crc);
		at += 4;
	}
	for (const e of sorted) {
		view.setUint32(at, offsets.get(e.oid) as number);
		at += 4;
	}
	idxBody.set(packSha, at);
	const idxSha = await sha1(idxBody);
	const index = concat([idxBody, idxSha], idxBody.length + 20);
	return { name: hex(packSha), pack, index };
}
