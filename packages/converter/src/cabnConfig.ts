import {
	type CabnConfig,
	CabnConfigValidationError,
	type PreviewOverride,
	type RichPortalPreview,
	validateCabnConfig,
} from "@cabn/world-schema";
import { markdownToStructuredPreview } from "./markdownPreview.js";
import { buildImagePreview } from "./richPreview.js";
import type { FileSource, SourceEntry } from "./sources/types.js";

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
	return entry.read();
}

export interface ResolvedOverride {
	preview: RichPortalPreview;
	/** Bundle-relative asset path -> bytes to merge into the WorldBundle (populated when the override copied an image). */
	assets: [string, Uint8Array][];
}

export async function resolveOverride(
	overriddenPath: string,
	override: PreviewOverride,
	entries: Map<string, SourceEntry>,
	maxFileBytes: number,
): Promise<ResolvedOverride> {
	switch (override.kind) {
		case "text":
			return { preview: { kind: "text", text: override.text }, assets: [] };

		case "image": {
			const bytes = await readOverrideBytes(
				overriddenPath,
				"src",
				override.src,
				entries,
				maxFileBytes,
			);
			const { preview, assetPath } = buildImagePreview(override.src, bytes);
			return { preview, assets: [[assetPath, bytes]] };
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
				assets: [],
			};
		}

		case "url": {
			const assets: [string, Uint8Array][] = [];
			let fallbackImage: string | undefined;
			if (override.fallbackImage) {
				const bytes = await readOverrideBytes(
					overriddenPath,
					"fallbackImage",
					override.fallbackImage,
					entries,
					maxFileBytes,
				);
				const built = buildImagePreview(override.fallbackImage, bytes);
				assets.push([built.assetPath, bytes]);
				fallbackImage = built.assetPath;
			}
			return {
				preview: {
					kind: "url",
					url: override.url,
					title: override.title,
					fallbackImage,
				},
				assets,
			};
		}
	}
}
