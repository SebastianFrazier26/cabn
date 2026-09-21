import { Unzip, type UnzipFile, UnzipInflate } from "fflate";
import { DEFAULT_MAX_FILE_BYTES, DEFAULT_MAX_FILES } from "../walk.js";
import type { FileSource, SourceEntry } from "./types.js";

export const DEFAULT_ZIP_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export interface ZipSourceOptions {
	/** Entry-count cap, enforced during extraction (not after). */
	maxFiles?: number;
	/** Per-entry decompressed-size cap; oversized entries become metadata-only. */
	maxFileBytes?: number;
	/** Whole-archive decompressed-size cap (zip-bomb backstop). */
	maxTotalBytes?: number;
}

interface ExtractedEntry {
	path: string;
	bytes: number;
	/** Absent for entries over maxFileBytes — metadata-only, same as oversized dir files. */
	content?: Uint8Array;
}

// Rejects zip-slip payloads: backslash-as-separator, absolute paths, and
// '.'/'..'/empty path segments (including the ones hidden by double slashes).
// fflate does no path safety of its own — entry names are attacker-controlled.
function sanitizeZipPath(rawName: string): string | undefined {
	const normalized = rawName.replace(/\\/g, "/");
	if (normalized.startsWith("/")) return undefined;
	const isDir = normalized.endsWith("/");
	const body = isDir ? normalized.slice(0, -1) : normalized;
	if (body.length === 0) return undefined;
	const segments = body.split("/");
	for (const segment of segments) {
		if (segment.length === 0 || segment === "." || segment === "..")
			return undefined;
	}
	return isDir ? `${body}/` : body;
}

function concat(chunks: Uint8Array[], totalLength: number): Uint8Array {
	const out = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/**
 * Extracts with hard caps enforced as fflate decompresses each entry, not
 * after the fact. This bounds *retained memory*: an entry whose real output
 * blows past maxFileBytes stops accumulating chunks the moment the cap is
 * crossed. fflate's synchronous UnzipInflate has no mid-stream abort, so a
 * single hostile entry still pays the CPU cost of full inflation — bounding
 * that too would require abandoning the sync, whole-buffer-in-memory API this
 * class is built on. That's an accepted, documented limit, not an oversight.
 */
function extractCapped(
	bytes: Uint8Array,
	opts: ZipSourceOptions,
): { entries: ExtractedEntry[]; dropped: number } {
	const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_ZIP_MAX_TOTAL_BYTES;

	const entries: ExtractedEntry[] = [];
	let totalRetainedBytes = 0;
	let dropped = 0;

	const unzipper = new Unzip();
	unzipper.register(UnzipInflate);

	unzipper.onfile = (file: UnzipFile) => {
		if (file.name.endsWith("/")) return; // directory entry

		const path = sanitizeZipPath(file.name);
		if (!path || path.endsWith("/")) return; // malformed or zip-slip name

		if (entries.length >= maxFiles || totalRetainedBytes >= maxTotalBytes) {
			dropped++;
			return;
		}

		// Cheap pre-filter for the common, honestly-labeled case. The chunk-level
		// cap below is what actually defends against a forged/small declared size.
		if (file.originalSize !== undefined && file.originalSize > maxFileBytes) {
			entries.push({ path, bytes: file.originalSize });
			return;
		}

		const chunks: Uint8Array[] = [];
		let received = 0;
		let capped = false;
		let settled = false;

		const settle = () => {
			if (settled) return;
			settled = true;
			if (capped) {
				entries.push({ path, bytes: received });
			} else {
				const content = concat(chunks, received);
				totalRetainedBytes += received;
				entries.push({ path, bytes: received, content });
			}
		};

		file.ondata = (err, chunk, final) => {
			if (settled) return;
			if (err) {
				settle();
				return;
			}
			if (!capped) {
				received += chunk.length;
				if (
					received > maxFileBytes ||
					totalRetainedBytes + received > maxTotalBytes
				) {
					capped = true;
					chunks.length = 0;
				} else {
					chunks.push(chunk);
				}
			}
			if (final) settle();
		};

		// fflate's UnzipInflate/store decoders resolve asynchronously relative to
		// start() itself, but synchronously relative to the enclosing push() call
		// below — verified empirically, not documented — so by the time push()
		// returns, every entry's `settle()` has already run via `ondata`'s
		// `final` flag. No call to settle() belongs here.
		file.start();
	};

	unzipper.push(bytes, true);
	return { entries, dropped };
}

export class ZipSource implements FileSource {
	private dropped = 0;

	constructor(
		private readonly bytes: Uint8Array,
		private readonly opts: ZipSourceOptions = {},
	) {}

	entries(): AsyncIterable<SourceEntry> {
		const { entries, dropped } = extractCapped(this.bytes, this.opts);
		this.dropped = dropped;
		return {
			async *[Symbol.asyncIterator]() {
				for (const entry of entries) {
					yield {
						path: entry.path,
						bytes: entry.bytes,
						read: () => Promise.resolve(entry.content ?? new Uint8Array(0)),
					};
				}
			},
		};
	}

	/** Whole entries dropped by maxFiles/maxTotalBytes during extraction (not just oversized-content entries, which are still listed). */
	droppedEntryCount(): number {
		return this.dropped;
	}
}
