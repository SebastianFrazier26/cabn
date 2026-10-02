import type { SearchDoc } from "@cabn/converter/core";
import { SEARCH_FIELDS, SEARCH_STORE_FIELDS } from "@cabn/converter/core";
import {
	type SearchIndexFile,
	SearchIndexFileSchema,
} from "@cabn/world-schema";
import MiniSearch from "minisearch";
import { useEffect, useRef, useState } from "react";
import { resolveRelativeUrl } from "../render/resolveUrl.js";

export type WorldSearchIndex = MiniSearch<SearchDoc>;

export interface WorldSearchIndexState {
	index: WorldSearchIndex | null;
	error: string | null;
	loading: boolean;
}

/** One fetch + parse of a world's search-index.json; also used by the pet's search tool. */
export async function fetchWorldSearchIndex(
	worldBase: string,
): Promise<WorldSearchIndex> {
	const res = await fetch(resolveRelativeUrl(worldBase, "search-index.json"));
	return loadWorldSearchIndex(SearchIndexFileSchema.parse(await res.json()));
}

export function loadWorldSearchIndex(file: SearchIndexFile): WorldSearchIndex {
	return MiniSearch.loadJSON<SearchDoc>(JSON.stringify(file.index), {
		fields: [...SEARCH_FIELDS],
		storeFields: [...SEARCH_STORE_FIELDS],
	});
}

/** The active world layer's index (systems/worldLayer.ts), loaded the first time the orb needs it while that layer shows. */
export function useLayerSearchIndex(
	provider: { searchIndex(): Promise<WorldSearchIndex> } | null,
	active: boolean,
): WorldSearchIndexState {
	const [state, setState] = useState<WorldSearchIndexState>({
		index: null,
		error: null,
		loading: false,
	});
	const loadedFor = useRef<object | null>(null);

	useEffect(() => {
		if (!provider) {
			loadedFor.current = null;
			setState({ index: null, error: null, loading: false });
			return;
		}
		if (!active || loadedFor.current === provider) return;
		let cancelled = false;
		setState((s) => ({ ...s, loading: true, error: null }));
		provider
			.searchIndex()
			.then((index) => {
				if (cancelled) return;
				loadedFor.current = provider;
				setState({ index, error: null, loading: false });
			})
			.catch((err) => {
				if (!cancelled)
					setState({
						index: null,
						error: err instanceof Error ? err.message : String(err),
						loading: false,
					});
			});
		return () => {
			cancelled = true;
		};
	}, [provider, active]);

	return state;
}

/**
 * Fetches and parses a world's search-index.json (minisearch's own toJSON
 * round-tripped through @cabn/world-schema's SearchIndexFileSchema) only
 * once `active` first goes true for a given worldBase, and caches the result
 * for the component's lifetime — the orb shouldn't cost a network request
 * until the player actually opens it, and shouldn't re-fetch every time they
 * toggle it closed and back open.
 */
export function useWorldSearchIndex(
	worldBase: string | null,
	active: boolean,
): WorldSearchIndexState {
	const [index, setIndex] = useState<WorldSearchIndex | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const loadedForBase = useRef<string | null>(null);

	useEffect(() => {
		if (!active || !worldBase || loadedForBase.current === worldBase) return;
		let cancelled = false;
		setLoading(true);
		setError(null);

		fetchWorldSearchIndex(worldBase)
			.then((mini) => {
				if (cancelled) return;
				loadedForBase.current = worldBase;
				setIndex(mini);
			})
			.catch((err) => {
				if (!cancelled)
					setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [worldBase, active]);

	return { index, error, loading };
}
