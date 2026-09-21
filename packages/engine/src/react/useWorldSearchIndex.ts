import type { SearchDoc } from "@cabn/converter/browser";
import { SEARCH_FIELDS, SEARCH_STORE_FIELDS } from "@cabn/converter/browser";
import { SearchIndexFileSchema } from "@cabn/world-schema";
import MiniSearch from "minisearch";
import { useEffect, useRef, useState } from "react";

export type WorldSearchIndex = MiniSearch<SearchDoc>;

export interface WorldSearchIndexState {
	index: WorldSearchIndex | null;
	error: string | null;
	loading: boolean;
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

		fetch(`${worldBase}search-index.json`)
			.then((res) => res.json())
			.then((raw) => {
				if (cancelled) return;
				const parsed = SearchIndexFileSchema.parse(raw);
				const mini = MiniSearch.loadJSON<SearchDoc>(
					JSON.stringify(parsed.index),
					{
						fields: [...SEARCH_FIELDS],
						storeFields: [...SEARCH_STORE_FIELDS],
					},
				);
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
