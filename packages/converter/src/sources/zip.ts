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

// Rejects zip-slip payloads: absolute paths, '.'/'..'/empty path segments
// (including ones hidden by double slashes), and traversal that only reads as
// dangerous on Windows — any backslash (so a UNC share `\\server\share\x` or
// an extended-length `\\?\C:\x` is caught by the backslash alone), a
// drive-relative segment ("C:", "C:..", "C:foo" — all valid on Windows
// without a leading slash or backslash), and NUL. This runs on every host
// platform regardless of which OS extracts the zip, so a payload that's only
// a traversal on Windows must still be rejected when built on a Mac/Linux
// host for a world someone else serves. fflate does no path safety of its
// own — entry names are attacker-controlled.
const DRIVE_RELATIVE = /^[A-Za-z]:/;

function sanitizeZipPath(rawName: string): string | undefined {
	if (rawName.includes("\\") || rawName.includes("\0")) return undefined;
	if (rawName.startsWith("/")) return undefined;
	const isDir = rawName.endsWith("/");
	const body = isDir ? rawName.slice(0, -1) : rawName;
	if (body.length === 0) return undefined;
	const segments = body.split("/");
	for (const segment of segments) {
		if (
			segment.length === 0 ||
			segment === "." ||
			segment === ".." ||
			DRIVE_RELATIVE.test(segment)
		)
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
		// walk() ignores .git anyway and zips never get history; skipping it
		// here means an uploaded repo's object store is never inflated and
		// can't eat the maxFiles/maxTotalBytes budget the real files need.
		if (path.split("/").includes(".git")) return;

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
			// Tracked unconditionally, capped or not — `bytes` in settle() must
			// report this entry's real size, not freeze at whatever had arrived
			// the moment a cap tripped.
			received += chunk.length;
			if (!capped) {
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
						// entry.content is genuinely undefined, not "", when a cap
						// withheld it (oversized or archive-wide-budget-capped) — see
						// SourceEntry.read()'s doc comment. Defaulting to an empty
						// array here used to make a withheld file indistinguishable
						// from a real zero-byte one.
						read: () => Promise.resolve(entry.content),
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
