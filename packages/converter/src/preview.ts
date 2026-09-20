const MAX_LINES = 12;
const MAX_LINE_CHARS = 120;
const MAX_TOTAL_BYTES = 512;

// TextEncoder, not Buffer.byteLength — this file must stay browser-safe.
const encoder = new TextEncoder();

export interface Preview {
	lines: string[];
	truncated: boolean;
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

		const cut = raw.length > MAX_LINE_CHARS;
		const line = cut ? raw.slice(0, MAX_LINE_CHARS) : raw;
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
