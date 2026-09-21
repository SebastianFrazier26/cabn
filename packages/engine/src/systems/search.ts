import type { CabnMode } from "../bridge/store.js";

/**
 * The orb searches two different things depending on where the player is:
 * the whole world's minisearch index (file-level results) while walking
 * around, or just the currently-open file's lines once inside one — there's
 * no server-side line index, so "jump to a line" only makes sense for text
 * already loaded client-side.
 */
export type SearchScope = "world" | "file";

export function resolveSearchScope(mode: CabnMode): SearchScope {
	return mode === "file" ? "file" : "world";
}

export interface WorldSearchHit {
	kind: "world";
	portalId: string;
	path: string;
	name: string;
	previewLine: string;
}

export interface FileSearchHit {
	kind: "file";
	line: number;
	snippet: string;
}

export type SearchHit = WorldSearchHit | FileSearchHit;

export type NavigationIntent =
	| { type: "walk-to-portal"; portalId: string }
	| { type: "jump-to-line"; line: number };

export function navigationIntentForHit(hit: SearchHit): NavigationIntent {
	return hit.kind === "world"
		? { type: "walk-to-portal", portalId: hit.portalId }
		: { type: "jump-to-line", line: hit.line };
}

/**
 * Minimal shape this module needs from a minisearch SearchResult — declared
 * locally instead of importing minisearch's own type so this stays testable
 * with plain object literals and doesn't couple pure logic to a specific
 * search-engine dependency.
 */
export interface RawWorldSearchResult {
	id: unknown;
	path: string;
	name: string;
}

export function toWorldSearchHits(
	results: readonly RawWorldSearchResult[],
	previewLineByPortalId: ReadonlyMap<string, string>,
): WorldSearchHit[] {
	return results.map((r) => {
		const portalId = String(r.id);
		return {
			kind: "world",
			portalId,
			path: r.path,
			name: r.name,
			previewLine: previewLineByPortalId.get(portalId) ?? "",
		};
	});
}

const SNIPPET_MAX_CHARS = 80;

/**
 * Case-insensitive per-line substring search over an already-loaded file's
 * content — no fuzzy matching (that's minisearch's job for the world-level
 * search); a jump target needs an exact line, not a ranked guess.
 */
export function searchFileLines(
	lines: readonly string[],
	query: string,
): FileSearchHit[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];

	const hits: FileSearchHit[] = [];
	lines.forEach((line, index) => {
		if (!line.toLowerCase().includes(needle)) return;
		const snippet =
			line.length > SNIPPET_MAX_CHARS
				? `${line.slice(0, SNIPPET_MAX_CHARS - 1)}…`
				: line;
		hits.push({ kind: "file", line: index, snippet });
	});
	return hits;
}
