import type { RGB } from "./color.js";

// WCAG 2.x relative luminance (sRGB -> linear per-channel, then Rec.709
// weights) — distinct from color.ts's `luminance()`, which is a fast Rec.601
// luma for palette sorting, not a spec-accurate contrast input.
function relativeLuminance(c: RGB): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: RGB, b: RGB): number {
	const l1 = relativeLuminance(a);
	const l2 = relativeLuminance(b);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

export function hexToRgb(hex: string): RGB {
	const n = Number.parseInt(hex.replace("#", ""), 16);
	return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
