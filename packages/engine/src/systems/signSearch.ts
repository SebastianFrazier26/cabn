import {
	isSeynPath,
	type SearchDoc,
	signSearchDoc,
} from "@cabn/converter/browser";
import { parseSeyn, type SignEntry } from "@cabn/world-schema";

/** The slice of MiniSearch this needs — structural so tests can pass a real index or a fake. */
export interface MutableSearchIndex {
	has(id: string): boolean;
	add(doc: SearchDoc): void;
	replace(doc: SearchDoc): void;
	discard(id: string): void;
}

/**
 * Brings a loaded search index's sign docs in line with the live sign list.
 * `cabn serve --owner` rewrites signs.json on every save/delete but not
 * search-index.json (rebuilding and refetching a whole world's index per
 * sign edit would cost far more than patching a few docs here), so the
 * index can lag the signs both within a session and after a reload.
 * `synced` maps sign path -> the source last written into this index;
 * the returned map replaces it. The first call (empty `synced`) rewrites
 * every sign, which is what corrects a stale index fetched after a reload.
 */
export function syncSignSearchDocs(
	index: MutableSearchIndex,
	signs: readonly SignEntry[],
	synced: ReadonlyMap<string, string>,
): Map<string, string> {
	const next = new Map<string, string>();
	for (const sign of signs) {
		next.set(sign.path, sign.source);
		if (synced.get(sign.path) === sign.source) continue;
		const doc = signSearchDoc(
			sign.path,
			parseSeyn(sign.source, { path: sign.path }),
		);
		if (index.has(sign.path)) index.replace(doc);
		else index.add(doc);
	}
	for (const path of synced.keys()) {
		if (!next.has(path) && index.has(path)) index.discard(path);
	}
	return next;
}

/**
 * A sign doc the index still holds for a sign that no longer exists — one
 * deleted before this page loaded, which syncSignSearchDocs never saw and
 * so can't discard. Hidden from results instead.
 */
export function isStaleSignHit(
	id: string,
	livePaths: ReadonlySet<string>,
): boolean {
	return isSeynPath(id) && !livePaths.has(id);
}
