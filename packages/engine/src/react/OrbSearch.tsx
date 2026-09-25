import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { PALETTE, toCssColor } from "../palette.js";
import {
	navigationIntentForHit,
	resolveSearchScope,
	type SearchHit,
	searchFileLines,
	toWorldSearchHits,
} from "../systems/search.js";
import { useCabnStore } from "./useCabnStore.js";
import { useWorldSearchIndex } from "./useWorldSearchIndex.js";

export interface OrbSearchProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

const WORLD_SEARCH_OPTIONS = { prefix: true, fuzzy: 0.2 };

/**
 * Crystal-orb search: fuzzy across the world's minisearch index while
 * walking around, or a plain per-line search of the file already open in
 * FileScene — see systems/search.ts for why these are two different things.
 */
export function OrbSearch({
	store,
	bus,
}: OrbSearchProps): React.ReactElement | null {
	const open = useCabnStore(store, (s) => s.searchOpen);
	const mode = useCabnStore(store, (s) => s.mode);
	const activeWorldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const activePortalContent = useCabnStore(store, (s) => s.activePortalContent);
	const portals = useCabnStore(store, (s) => s.portals);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const scope = resolveSearchScope(mode);
	const { index, error, loading } = useWorldSearchIndex(
		activeWorldBase,
		open && scope === "world",
	);

	useEffect(() => {
		if (!open) {
			setQuery("");
			return;
		}
		// Biome's a11y/noAutofocus rule wants intentional focus management, not
		// an `autoFocus` prop — this is that: focus only when the modal actually
		// opens, not on every mount.
		inputRef.current?.focus();
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") store.getState().setSearchOpen(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, store]);

	const previewLineByPortalId = useMemo(
		() => new Map(portals.map((p) => [p.id, p.previewLine] as const)),
		[portals],
	);

	const hits: SearchHit[] = useMemo(() => {
		if (!query.trim()) return [];
		if (scope === "file") {
			return searchFileLines((activePortalContent ?? "").split("\n"), query);
		}
		if (!index) return [];
		// minisearch's SearchResult only statically types id/terms/score/match —
		// path/name are stored fields spread on at runtime (SEARCH_STORE_FIELDS),
		// so they're pulled out explicitly rather than trying to widen the
		// library's own result type.
		const rawResults = index.search(query, WORLD_SEARCH_OPTIONS).map((r) => ({
			id: r.id,
			path: r.path as string,
			name: r.name as string,
		}));
		return toWorldSearchHits(rawResults, previewLineByPortalId);
	}, [query, scope, index, activePortalContent, previewLineByPortalId]);

	if (!open) return null;

	const select = (hit: SearchHit) => {
		const intent = navigationIntentForHit(hit);
		if (intent.type === "walk-to-portal")
			bus.emit("tool:walk-to-portal", { portalId: intent.portalId });
		else bus.emit("tool:jump-to-line", { line: intent.line });
		store.getState().setSearchOpen(false);
	};

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				background: "rgba(50, 34, 20, 0.6)",
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				paddingTop: "12vh",
				zIndex: 7,
			}}
		>
			<div
				style={{
					width: "min(520px, 90vw)",
					background: toCssColor(PALETTE.parchment),
					color: toCssColor(PALETTE.ink),
					border: `3px solid ${toCssColor(PALETTE.ink)}`,
					borderRadius: 8,
					fontFamily: '"Courier New", monospace',
					overflow: "hidden",
				}}
			>
				<div
					style={{
						padding: "10px 14px",
						borderBottom: `2px solid ${toCssColor(PALETTE.ink)}`,
					}}
				>
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={
							scope === "file" ? "search this file..." : "search the world..."
						}
						style={{
							width: "100%",
							font: "inherit",
							fontSize: 14,
							background: "transparent",
							border: "none",
							outline: "none",
							color: "inherit",
						}}
					/>
				</div>
				<div style={{ maxHeight: "50vh", overflow: "auto" }}>
					{scope === "world" && loading && (
						<Status text="loading the world's search index..." />
					)}
					{scope === "world" && error && (
						<Status text={`search index failed to load: ${error}`} />
					)}
					{hits.length === 0 && query.trim() && !loading && (
						<Status text="no matches" />
					)}
					<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
						{hits.map((hit) => (
							<SearchHitRow
								key={hit.kind === "world" ? hit.portalId : `line-${hit.line}`}
								hit={hit}
								onSelect={() => select(hit)}
							/>
						))}
					</ul>
				</div>
			</div>
		</div>
	);
}

function Status({ text }: { text: string }): React.ReactElement {
	return (
		<div style={{ padding: "10px 14px", opacity: 0.7, fontSize: 12 }}>
			{text}
		</div>
	);
}

function SearchHitRow({
	hit,
	onSelect,
}: {
	hit: SearchHit;
	onSelect: () => void;
}): React.ReactElement {
	const title = hit.kind === "world" ? hit.path : `line ${hit.line + 1}`;
	const snippet = hit.kind === "world" ? hit.previewLine : hit.snippet;
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				style={{
					width: "100%",
					textAlign: "left",
					background: "none",
					border: "none",
					borderBottom: `1px solid ${toCssColor(PALETTE.trail)}`,
					padding: "8px 14px",
					cursor: "pointer",
					color: "inherit",
					display: "flex",
					flexDirection: "column",
					gap: 2,
				}}
			>
				<strong style={{ fontSize: 13 }}>{title}</strong>
				{snippet && (
					<span style={{ fontSize: 11, opacity: 0.75 }}>{snippet}</span>
				)}
			</button>
		</li>
	);
}
