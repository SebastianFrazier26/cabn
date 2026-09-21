import type { SearchIndexFile } from "@cabn/world-schema";
import MiniSearch from "minisearch";

// Pinned exactly (package.json has no "^") specifically so this constant
// can't silently drift out of sync with the installed minisearch version.
export const MINISEARCH_VERSION = "7.2.0";

export interface SearchDoc {
	id: string;
	path: string;
	name: string;
	content: string;
}

export const SEARCH_FIELDS = ["path", "name", "content"] as const;
export const SEARCH_STORE_FIELDS = ["path", "name"] as const;

export function buildSearchIndex(docs: SearchDoc[]): SearchIndexFile {
	const mini = new MiniSearch<SearchDoc>({
		fields: [...SEARCH_FIELDS],
		storeFields: [...SEARCH_STORE_FIELDS],
	});
	mini.addAll(docs);

	return {
		engine: "minisearch",
		version: MINISEARCH_VERSION,
		// MiniSearch implements toJSON(); round-tripping through JSON here
		// keeps `index` a plain value ready to embed in search-index.json.
		index: JSON.parse(JSON.stringify(mini)),
	};
}
