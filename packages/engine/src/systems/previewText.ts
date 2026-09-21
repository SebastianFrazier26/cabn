/**
 * Re-clamps a portal's already-clamped PortalPreview.lines (schema caps at 12
 * lines / 120 chars) down to whatever a small floating panel can actually
 * show. Kept pure and separate from the schema's own clamp so the panel's
 * display budget can change without touching the converter's contract.
 */
export interface ClampedPreview {
	lines: string[];
	truncated: boolean;
}

const ELLIPSIS = "…";

export function clampPreviewLines(
	lines: readonly string[],
	maxLineChars: number,
	maxLines: number,
): ClampedPreview {
	let truncated = lines.length > maxLines;
	const visible = lines.slice(0, maxLines).map((line) => {
		if (line.length <= maxLineChars) return line;
		truncated = true;
		return line.slice(0, Math.max(0, maxLineChars - 1)) + ELLIPSIS;
	});
	return { lines: visible, truncated };
}
