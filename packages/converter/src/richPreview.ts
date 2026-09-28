import {
	CODE_PREVIEW_MAX_LINE_CHARS,
	CODE_PREVIEW_MAX_LINES,
	CODE_PREVIEW_MAX_TOTAL_BYTES,
	type CodePreview,
	type ImagePreview,
} from "@cabn/world-schema";
import { shortHash } from "./hash.js";
import { sniffImageDimensions } from "./imageDimensions.js";
import { safeCutLength } from "./preview.js";

const encoder = new TextEncoder();

/**
 * The default "code" richPreview: literal first N lines (blank lines kept —
 * unlike the old compact buildPreview, this is meant for full syntax-coloured
 * rendering where dropping blank lines would misrender indentation-sensitive
 * or intentionally-spaced code) up to CODE_PREVIEW_MAX_LINES/LINE_CHARS/
 * TOTAL_BYTES.
 */
export function buildCodePreview(
	content: string,
	language: string | undefined,
): CodePreview {
	const rawLines = content.split(/\r\n|\r|\n/);
	const lines: string[] = [];
	let totalBytes = 0;
	let truncated = rawLines.length > CODE_PREVIEW_MAX_LINES;

	for (let i = 0; i < rawLines.length && i < CODE_PREVIEW_MAX_LINES; i++) {
		const raw = rawLines[i] ?? "";
		const cutLength = safeCutLength(raw, CODE_PREVIEW_MAX_LINE_CHARS);
		const cut = raw.length > cutLength;
		const line = cut ? raw.slice(0, cutLength) : raw;
		const lineBytes = encoder.encode(line).length;

		if (totalBytes + lineBytes > CODE_PREVIEW_MAX_TOTAL_BYTES) {
			truncated = true;
			break;
		}
		if (cut) truncated = true;
		lines.push(line);
		totalBytes += lineBytes;
	}

	return { kind: "code", lines, language, truncated };
}

function assetExtension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? "" : path.slice(dot);
}

/**
 * Deterministic bundle-relative path for a copied preview image: hashes the
 * source path + byte length, not just the basename, so two portals whose
 * source images happen to share a filename ("logo.png" in two different
 * directories, or an override's src vs. the overridden portal's own path)
 * don't collide — and re-converting the same source reproduces the same
 * asset path (stable, diffable bundles across runs).
 */
export function previewAssetPath(
	sourcePath: string,
	bytes: Uint8Array,
): string {
	const hash = shortHash(`${sourcePath}:${bytes.length}`, 12);
	return `assets/previews/${hash}${assetExtension(sourcePath)}`;
}

/**
 * Builds an ImagePreview plus the bundle asset it points at. Copies the
 * original bytes as-is rather than a resized thumbnail — see README for why
 * (real downscaling needs a native decoder like sharp, which the converter
 * can't depend on; deferred to a future CLI/build-time step).
 */
export function buildImagePreview(
	sourcePath: string,
	bytes: Uint8Array,
): { preview: ImagePreview; assetPath: string } {
	const assetPath = previewAssetPath(sourcePath, bytes);
	const dims = sniffImageDimensions(bytes);
	return {
		preview: { kind: "image", asset: assetPath, bytes: bytes.length, ...dims },
		assetPath,
	};
}
