import {
	type CabnConfig,
	CabnConfigValidationError,
	type PreviewOverride,
	type RichPortalPreview,
	validateCabnConfig,
} from "@cabn/world-schema";
import { markdownToStructuredPreview } from "./markdownPreview.js";
import { type MediaBudget, mediaFormatForPath } from "./media.js";
import { buildImagePreview } from "./richPreview.js";
import type { FileSource, SourceEntry } from "./sources/types.js";
import { isHiddenPath } from "./walk.js";

const CABN_CONFIG_PATH = "cabn.json";
const decoder = new TextDecoder("utf-8", { fatal: false });

/** Wraps both "cabn.json itself is malformed" and "an override inside it doesn't resolve" so every failure this module can produce carries a clear, path-prefixed message. */
export class CabnConfigError extends Error {
	constructor(message: string) {
		super(`${CABN_CONFIG_PATH}: ${message}`);
		this.name = "CabnConfigError";
	}
}

export interface LoadedCabnConfig {
	/** undefined when the source has no cabn.json at its root — not an error, just "no overrides for this world". */
	config: CabnConfig | undefined;
	/**
	 * Every entry the source yields, keyed by path. Collected once here (a
	 * full source.entries() drain, independent of walk()'s own drain later in
	 * convert()) so override `src`/`fallbackImage` lookups don't need a
	 * per-path re-scan. Known cost: for ZipSource this decompresses the
	 * archive twice per conversion (once here, once in walk()) — acceptable
	 * for phase 1, flagged in the PR description as a follow-up (share one
	 * drain between the two via an in-memory FileSource wrapper).
	 */
	entries: Map<string, SourceEntry>;
}

export async function loadCabnConfig(
	source: FileSource,
): Promise<LoadedCabnConfig> {
	const entries = new Map<string, SourceEntry>();
	for await (const entry of source.entries()) entries.set(entry.path, entry);

	const configEntry = entries.get(CABN_CONFIG_PATH);
	if (!configEntry) return { config: undefined, entries };

	const raw = await configEntry.read();
	// Only reachable if cabn.json itself tripped a source's archive-wide byte
	// cap (it's never secret-patterned or oversized on its own — checkOverrideTargetsExist
	// never runs, so this is the clearest place to say so).
	if (raw === undefined) {
		throw new CabnConfigError(
			"could not be read (the archive's total size cap was reached before its content)",
		);
	}
	let json: unknown;
	try {
		json = JSON.parse(decoder.decode(raw));
	} catch (err) {
		throw new CabnConfigError(`invalid JSON (${(err as Error).message})`);
	}

	try {
		return { config: validateCabnConfig(json), entries };
	} catch (err) {
		if (err instanceof CabnConfigValidationError) {
			throw new CabnConfigError(err.issues);
		}
		throw err;
	}
}

/**
 * A cabn.json is validated in isolation (shape, https/origin rules) before
 * the converter ever sees which files actually exist — this closes the gap:
 * an override path that doesn't match any converted file is very likely a
 * typo, so it fails loudly rather than being silently ignored.
 */
export function checkOverrideTargetsExist(
	config: CabnConfig,
	portalPaths: ReadonlySet<string>,
): void {
	for (const path of Object.keys(config.previews)) {
		// A hidden file is left out of every normal world on purpose (walk's
		// hidden rule), so an override naming one is not a typo.
		if (isHiddenPath(path)) continue;
		if (!portalPaths.has(path)) {
			throw new CabnConfigError(
				`previews["${path}"] does not match any file in this world (check for a typo, or a path excluded by ignore rules/file caps)`,
			);
		}
	}
}

async function readOverrideBytes(
	overriddenPath: string,
	fieldLabel: string,
	src: string,
	entries: Map<string, SourceEntry>,
	maxFileBytes: number,
): Promise<Uint8Array> {
	// Refused rather than read: a normal world never carries a hidden file's bytes.
	if (isHiddenPath(src)) {
		throw new CabnConfigError(
			`previews["${overriddenPath}"].${fieldLabel} "${src}" is a hidden path; hidden files never appear in a normal world`,
		);
	}
	const entry = entries.get(src);
	if (!entry) {
		throw new CabnConfigError(
			`previews["${overriddenPath}"].${fieldLabel} "${src}" does not exist in the world source`,
		);
	}
	if (entry.bytes > maxFileBytes) {
		throw new CabnConfigError(
			`previews["${overriddenPath}"].${fieldLabel} "${src}" is ${entry.bytes} bytes, over the ${maxFileBytes}-byte cap applied to every file in this conversion`,
		);
	}
	const bytes = await entry.read();
	// Under maxFileBytes but still content-less: the archive-wide total cap
	// withheld it (see SourceEntry.read()'s doc comment), not a per-file one —
	// the check above already ruled that out.
	if (bytes === undefined) {
		throw new CabnConfigError(
			`previews["${overriddenPath}"].${fieldLabel} "${src}" could not be read (the archive's total size cap was reached before its content)`,
		);
	}
	return bytes;
}

export interface ResolvedOverride {
	preview: RichPortalPreview;
}

/**
 * Override images go through the same MediaBudget as every other shipped
 * media file (magic-byte check, per-file cap, world budget). A src whose
 * bytes aren't a supported raster image is the author's mistake and fails
 * loudly; running out of budget is not, so it degrades like any other
 * over-budget file — undefined here, which callers turn into a sealed chest
 * (or a url card without its fallback picture).
 */
function admitOverrideImage(
	overriddenPath: string,
	fieldLabel: string,
	src: string,
	bytes: Uint8Array,
	budget: MediaBudget,
): string | undefined {
	const admission = budget.admit(mediaFormatForPath(src) ?? "png", bytes, {
		exactFormat: false,
	});
	if (admission.ok) return admission.assetPath;
	if (admission.reason === "type-mismatch") {
		throw new CabnConfigError(
			`previews["${overriddenPath}"].${fieldLabel} "${src}" is not a PNG, JPEG, GIF, or WebP image (checked by its content, not its extension)`,
		);
	}
	return undefined;
}

export async function resolveOverride(
	overriddenPath: string,
	override: PreviewOverride,
	entries: Map<string, SourceEntry>,
	maxFileBytes: number,
	budget: MediaBudget,
): Promise<ResolvedOverride> {
	switch (override.kind) {
		case "text":
			return { preview: { kind: "text", text: override.text } };

		case "image": {
			const bytes = await readOverrideBytes(
				overriddenPath,
				"src",
				override.src,
				entries,
				maxFileBytes,
			);
			const assetPath = admitOverrideImage(
				overriddenPath,
				"src",
				override.src,
				bytes,
				budget,
			);
			return {
				preview: assetPath
					? buildImagePreview(assetPath, bytes)
					: { kind: "sealed" },
			};
		}

		case "markdown": {
			const bytes = await readOverrideBytes(
				overriddenPath,
				"src",
				override.src,
				entries,
				maxFileBytes,
			);
			return {
				preview: markdownToStructuredPreview(decoder.decode(bytes)),
			};
		}

		case "url": {
			let fallbackImage: string | undefined;
			if (override.fallbackImage) {
				const bytes = await readOverrideBytes(
					overriddenPath,
					"fallbackImage",
					override.fallbackImage,
					entries,
					maxFileBytes,
				);
				fallbackImage = admitOverrideImage(
					overriddenPath,
					"fallbackImage",
					override.fallbackImage,
					bytes,
					budget,
				);
			}
			return {
				preview: {
					kind: "url",
					url: override.url,
					title: override.title,
					fallbackImage,
				},
			};
		}
	}
}
