import { WorldChunkSchema } from "@cabn/world-schema";
import {
	fetchWorldSearchIndex,
	type WorldSearchIndex,
} from "../react/useWorldSearchIndex.js";
import type { PetFileInfo, PetWorldAccess } from "./tools.js";

/**
 * Builds the pet's view of the current world from what WorldScene already
 * has: the portal list, its loaded (override-applied) chunk text, and the
 * chunk files on the world's own origin. Chunks the player hasn't walked
 * near yet are fetched here into a small cache of the pet's own, so asking
 * about a far-off file doesn't disturb WorldScene's chunk LRU.
 */
export interface PetWorldSource {
	files: readonly PetFileInfo[];
	worldBase: string;
	/** Effective text if WorldScene has the file's chunk loaded. */
	loadedText(path: string): string | undefined;
	/** A saved quill edit for the file, if any. */
	savedOverride(path: string): string | undefined;
	/** The chunk file (relative to worldBase) holding this path's text. */
	chunkFor(path: string): string | undefined;
	/** A reason the file must not leave the browser, or null. */
	withheld(path: string): string | null;
	fetch?: typeof fetch;
}

const CHUNK_CACHE_LIMIT = 8;
const SEARCH_OPTIONS = { prefix: true, fuzzy: 0.2 };

export function createPetWorldAccess(source: PetWorldSource): PetWorldAccess {
	const doFetch = source.fetch ?? fetch;
	const chunkCache = new Map<string, Promise<Record<string, string>>>();
	let searchIndex: Promise<WorldSearchIndex> | null = null;

	const loadChunk = (chunk: string): Promise<Record<string, string>> => {
		const cached = chunkCache.get(chunk);
		if (cached) return cached;
		const pending = doFetch(`${source.worldBase}${chunk}`)
			.then((res) => res.json())
			.then((raw) => {
				const parsed = WorldChunkSchema.parse(raw);
				const files: Record<string, string> = {};
				for (const [path, file] of Object.entries(parsed.files))
					files[path] = file.content;
				return files;
			});
		pending.catch(() => chunkCache.delete(chunk));
		chunkCache.set(chunk, pending);
		while (chunkCache.size > CHUNK_CACHE_LIMIT) {
			const oldest = chunkCache.keys().next().value;
			if (oldest === undefined) break;
			chunkCache.delete(oldest);
		}
		return pending;
	};

	return {
		files: () => source.files,
		withheld: (path) => source.withheld(path),
		async readText(path) {
			const loaded = source.loadedText(path);
			if (loaded !== undefined) return loaded;
			const chunk = source.chunkFor(path);
			if (!chunk) return null;
			const files = await loadChunk(chunk);
			// Binary files never make it into a chunk, so they read as null.
			if (!(path in files)) return null;
			return source.savedOverride(path) ?? files[path] ?? null;
		},
		async search(query, limit) {
			searchIndex ??= fetchWorldSearchIndex(source.worldBase).catch((err) => {
				searchIndex = null;
				throw err;
			});
			const index = await searchIndex;
			return index
				.search(query, SEARCH_OPTIONS)
				.slice(0, limit)
				.map((r) => ({ path: String(r.path ?? r.id) }));
		},
	};
}
