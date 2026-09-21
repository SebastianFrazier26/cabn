const MAX_LINES = 12;
const MAX_LINE_CHARS = 120;
const MAX_TOTAL_BYTES = 512;

// TextEncoder, not Buffer.byteLength — this file must stay browser-safe.
const encoder = new TextEncoder();

export interface Preview {
	lines: string[];
	truncated: boolean;
}

// A slice at exactly MAX_LINE_CHARS can land between a surrogate pair (an
// astral character, e.g. most emoji, is two UTF-16 code units). Back the cut
// off by one unit rather than splitting the pair into a lone lead surrogate,
// which would corrupt the character on the next UTF-8 encode.
function safeCutLength(raw: string, maxChars: number): number {
	if (raw.length <= maxChars) return raw.length;
	const codeAtBoundary = raw.charCodeAt(maxChars - 1);
	const isLeadSurrogate = codeAtBoundary >= 0xd800 && codeAtBoundary <= 0xdbff;
	return isLeadSurrogate ? maxChars - 1 : maxChars;
}

/**
 * First <=12 non-blank lines of `content`, each cut to 120 chars, capped at
 * 512 total bytes. `truncated` is true whenever anything was cut: a
 * too-long line, more non-blank lines than fit, or the byte cap was hit.
 */
export function buildPreview(content: string): Preview {
	const rawLines = content.split(/\r\n|\r|\n/);
	const lines: string[] = [];
	let truncated = false;
	let totalBytes = 0;

	for (const raw of rawLines) {
		if (raw.trim().length === 0) continue;
		if (lines.length >= MAX_LINES) {
			truncated = true;
			break;
		}

		const cutLength = safeCutLength(raw, MAX_LINE_CHARS);
		const cut = raw.length > cutLength;
		const line = cut ? raw.slice(0, cutLength) : raw;
		const lineBytes = encoder.encode(line).length;

		if (totalBytes + lineBytes > MAX_TOTAL_BYTES) {
			truncated = true;
			break;
		}

		if (cut) truncated = true;
		lines.push(line);
		totalBytes += lineBytes;
	}

	// Non-blank lines remain after where we stopped (covers the case where we
	// hit neither cap but there are still more candidate lines further down).
	if (!truncated) {
		const consumedRawCount = (() => {
			let nonBlankSeen = 0;
			for (let i = 0; i < rawLines.length; i++) {
				if (rawLines[i]?.trim().length) {
					nonBlankSeen++;
					if (nonBlankSeen === lines.length) return i + 1;
				}
			}
			return rawLines.length;
		})();
		const remainder = rawLines.slice(consumedRawCount);
		truncated = remainder.some((l) => l.trim().length > 0);
	}

	return { lines, truncated };
}
