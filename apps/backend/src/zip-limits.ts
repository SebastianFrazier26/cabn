import { unzipSync } from "fflate";

/**
 * Entries this small are exempt from the ratio cap: a few KiB of whitespace
 * legitimately compresses past 100:1, and the whole-archive inflation cap
 * already bounds what many small entries can add up to.
 */
export const RATIO_CHECK_MIN_BYTES = 64 * 1024;

export interface ZipLimits {
	maxInflationBytes: number;
	maxCompressionRatio: number;
}

export type ZipLimitVerdict =
	| { ok: true }
	| { ok: false; reason: "inflation" | "ratio" | "unreadable" };

/**
 * Checks the sizes the central directory declares, before anything is
 * inflated. Declared sizes can be forged; this only rejects honestly-labelled
 * bombs cheaply. A lying archive is still bounded by ZipSource's streaming
 * per-entry and total caps, the worker's heap limit and its wall-clock timeout.
 */
export function checkZipLimits(
	bytes: Uint8Array,
	limits: ZipLimits,
): ZipLimitVerdict {
	let total = 0;
	let verdict: ZipLimitVerdict = { ok: true };
	try {
		// A filter that always returns false walks the central directory
		// (zip64 sizes included) without inflating a single entry.
		unzipSync(bytes, {
			filter(file) {
				if (!verdict.ok) return false;
				total += file.originalSize;
				if (total > limits.maxInflationBytes) {
					verdict = { ok: false, reason: "inflation" };
				} else if (
					file.originalSize >= RATIO_CHECK_MIN_BYTES &&
					file.originalSize > file.size * limits.maxCompressionRatio
				) {
					verdict = { ok: false, reason: "ratio" };
				}
				return false;
			},
		});
	} catch {
		return { ok: false, reason: "unreadable" };
	}
	return verdict;
}
