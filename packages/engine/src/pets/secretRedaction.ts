import { findLeakedSecretSpans, locAt } from "@cabn/converter/browser";

/**
 * Redacts the exact spans the magpie/leakedSecret detector flags before a
 * file's text reaches the AI pet's provider (2026-09-28). An undefeated
 * magpie used to withhold the whole file; now the file is sent with only
 * the secret values swapped for a fixed marker, so the pet can still help
 * with the rest of it.
 */

export const REDACTION_MARKER = "«redacted secret»";

export interface RedactedSpan {
	start: number;
	end: number;
}

export interface RedactionResult {
	text: string;
	/** Number of markers inserted — what tools.ts tells the model. */
	count: number;
	/** Merged, provider-key-extended spans in the *original* content's offsets — propose_edit's safety check needs these, not the marker-substituted text. */
	spans: readonly RedactedSpan[];
}

// scanPrivateKeys (leakedSecret.ts) only matches the PEM header line and
// confirms a body follows without including it in the hit span, so redacting
// just that span would ship the actual key material unredacted. Extend
// through the matching END line instead.
const PEM_END_LINE = /-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

function extendPrivateKeySpan(content: string, end: number): number {
	PEM_END_LINE.lastIndex = end;
	const match = PEM_END_LINE.exec(content);
	return match ? match.index + match[0].length : content.length;
}

// Extending private-key spans can make them overlap a later hit; merging
// keeps the marker-insertion loop below from ever double-covering a span.
function mergeSpans(spans: readonly RedactedSpan[]): RedactedSpan[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	const merged: RedactedSpan[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && span.start <= last.end) {
			last.end = Math.max(last.end, span.end);
		} else {
			merged.push({ ...span });
		}
	}
	return merged;
}

export function redactSecrets(content: string, path: string): RedactionResult {
	const rawSpans = findLeakedSecretSpans(content, path).map((span) =>
		span.kind === "private-key"
			? { start: span.start, end: extendPrivateKeySpan(content, span.end) }
			: { start: span.start, end: span.end },
	);
	if (rawSpans.length === 0) return { text: content, count: 0, spans: [] };
	const spans = mergeSpans(rawSpans);

	let text = "";
	let cursor = 0;
	for (const span of spans) {
		text += content.slice(cursor, span.start);
		// One marker per line inside the span, not one marker for the whole
		// span — a multi-line PEM body redacts to N markers on N lines
		// instead of collapsing them into one, which is what keeps line
		// numbers valid for propose_edit against the redacted text.
		const lineCount = content.slice(span.start, span.end).split("\n").length;
		text += Array.from({ length: lineCount }, () => REDACTION_MARKER).join(
			"\n",
		);
		cursor = span.end;
	}
	text += content.slice(cursor);
	return { text, count: spans.length, spans };
}

/**
 * Whether an edit's matched range in the *real* text overlaps a redacted
 * line. propose_edit rejects any hunk this returns true for — see tools.ts
 * for why rejecting (rather than re-inserting the real value on apply) is
 * the chosen, safer option.
 */
export function touchesRedactedSpan(
	content: string,
	spans: readonly RedactedSpan[],
	rangeStart: number,
	rangeEnd: number,
): boolean {
	if (spans.length === 0 || rangeEnd <= rangeStart) return false;
	const editStartLine = locAt(content, rangeStart).line;
	const editEndLine = locAt(content, rangeEnd - 1).line;
	return spans.some((span) => {
		const spanStartLine = locAt(content, span.start).line;
		const spanEndLine = locAt(content, Math.max(span.start, span.end - 1)).line;
		return editStartLine <= spanEndLine && editEndLine >= spanStartLine;
	});
}
