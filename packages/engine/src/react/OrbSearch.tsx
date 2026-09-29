import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { uiScreenPath, uiSparklePath } from "../assetPaths.js";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import {
	navigationIntentForHit,
	resolveSearchScope,
	type SearchHit,
	searchFileLines,
	toWorldSearchHits,
} from "../systems/search.js";
import { isStaleSignHit, syncSignSearchDocs } from "../systems/signSearch.js";
import { isHiddenPath } from "../systems/worldLayer.js";
import { useCabnStore } from "./useCabnStore.js";
import {
	useLayerSearchIndex,
	useWorldSearchIndex,
	type WorldSearchIndex,
} from "./useWorldSearchIndex.js";

export interface OrbSearchProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

const WORLD_SEARCH_OPTIONS = { prefix: true, fuzzy: 0.2 };

// Ambient sparkles drifting in the mist backdrop (STYLE.md: "twice as many
// sparkles at higher opacity" than v2) — purely decorative, positions/colors/
// delays hand-picked the same way mockup.html's own are.
const AMBIENT_SPARKLES: ReadonlyArray<{
	color: "violet" | "cyan" | "gold";
	top: string;
	left: string;
	width: number;
	delayMs: number;
}> = [
	{ color: "violet", top: "15%", left: "12%", width: 22, delayMs: 0 },
	{ color: "cyan", top: "70%", left: "20%", width: 18, delayMs: 400 },
	{ color: "violet", top: "20%", left: "85%", width: 16, delayMs: 800 },
	{ color: "cyan", top: "80%", left: "80%", width: 24, delayMs: 1200 },
	{ color: "gold", top: "45%", left: "6%", width: 16, delayMs: 200 },
	{ color: "gold", top: "10%", left: "55%", width: 14, delayMs: 600 },
	{ color: "violet", top: "60%", left: "92%", width: 16, delayMs: 1000 },
	{ color: "cyan", top: "90%", left: "45%", width: 14, delayMs: 1400 },
];

// Open-burst sparks radiating from the modal on mount — violet/cyan/gold, per
// STYLE.md's orb color pairing.
const OPEN_BURST_SPARKS: ReadonlyArray<{
	color: "violet" | "cyan" | "gold";
	tx: number;
	ty: number;
	delayMs: number;
}> = [
	{ color: "violet", tx: -90, ty: -50, delayMs: 0 },
	{ color: "cyan", tx: 90, ty: -50, delayMs: 50 },
	{ color: "gold", tx: 0, ty: -90, delayMs: 100 },
	{ color: "violet", tx: -90, ty: 50, delayMs: 150 },
	{ color: "cyan", tx: 90, ty: 50, delayMs: 200 },
	{ color: "gold", tx: 0, ty: 90, delayMs: 250 },
];

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
	const activeFileState = useCabnStore(store, (s) => s.activeFileState);
	const activeFileDoc = activeFileState?.doc ?? null;
	const portals = useCabnStore(store, (s) => s.portals);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const scope = resolveSearchScope(mode);
	const { index, error, loading } = useWorldSearchIndex(
		activeWorldBase,
		open && scope === "world",
	);
	const activeLayerId = useCabnStore(store, (s) => s.activeLayerId);
	const worldLayers = useCabnStore(store, (s) => s.worldLayers);
	const layer = useMemo(
		() => worldLayers.find((l) => l.id === activeLayerId) ?? null,
		[worldLayers, activeLayerId],
	);
	const layerSearch = useLayerSearchIndex(layer, open && scope === "world");
	const layerIndex = layerSearch.index;

	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Same capture + preventDefault as SpyglassPanel's Esc.
			event.preventDefault();
			store.getState().setSearchOpen(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open, store]);

	// Remounting the burst element (key={playToken}) on every open is what
	// retriggers its CSS animation — same "remount == retrigger" pattern
	// RunOverlay's own unfurl animation already relies on.
	const [playToken, setPlayToken] = useState(0);
	useEffect(() => {
		if (open) setPlayToken((token) => token + 1);
	}, [open]);

	// Biome's a11y/noAutofocus rule wants intentional focus management, not an
	// `autoFocus` prop — this is that. Keyed on playToken too: the input lives
	// inside the remounted (key={playToken}) ball, so focusing on `open` alone
	// would land on the instance that remount immediately replaces.
	// biome-ignore lint/correctness/useExhaustiveDependencies: playToken is the remount signal, not read inside
	useEffect(() => {
		if (open) inputRef.current?.focus();
	}, [open, playToken]);

	// Only owner mode writes signs at runtime; a read-only world's index and
	// signs.json come from the same build, so they're left untouched there.
	const ownerSigns = useCabnStore(store, (s) => s.ownerSigns !== null);
	const signs = useCabnStore(store, (s) => s.signs);
	const syncedSigns = useRef<SignSync>({ index: null, sources: new Map() });
	const syncedLayerSigns = useRef<SignSync>({
		index: null,
		sources: new Map(),
	});
	// Hidden-folder signs belong to the layer's own index, never the world's.
	const [baseSigns, layerSigns] = useMemo(
		() =>
			[
				signs.filter((s) => !isHiddenPath(s.path)),
				signs.filter((s) => isHiddenPath(s.path)),
			] as const,
		[signs],
	);
	const liveSignPaths = useMemo(
		() =>
			ownerSigns && index
				? syncSigns(syncedSigns.current, index, baseSigns)
				: null,
		[ownerSigns, index, baseSigns],
	);
	const liveLayerSignPaths = useMemo(
		() =>
			layerIndex
				? syncSigns(syncedLayerSigns.current, layerIndex, layerSigns)
				: null,
		[layerIndex, layerSigns],
	);

	const previewLineByPortalId = useMemo(
		() => new Map(portals.map((p) => [p.id, p.previewLine] as const)),
		[portals],
	);

	const hits: SearchHit[] = useMemo(() => {
		if (!query.trim()) return [];
		if (scope === "file") {
			return searchFileLines(activeFileDoc?.toJSON() ?? [], query);
		}
		if (!index) return [];
		// minisearch's SearchResult only statically types id/terms/score/match —
		// path/name are stored fields spread on at runtime (SEARCH_STORE_FIELDS),
		// so they're pulled out explicitly rather than trying to widen the
		// library's own result type.
		const run = (
			from: WorldSearchIndex,
			live: ReadonlySet<string> | null,
			isLayer: boolean,
		) =>
			from
				.search(query, WORLD_SEARCH_OPTIONS)
				.filter((r) => !live || !isStaleSignHit(String(r.id), live))
				.map((r) => ({
					id: r.id,
					path: r.path as string,
					name: r.name as string,
					score: r.score,
					isLayer,
				}));
		const rawResults = [
			...run(index, liveSignPaths, false),
			...(layerIndex ? run(layerIndex, liveLayerSignPaths, true) : []),
		].sort((a, b) => b.score - a.score);
		const hits = toWorldSearchHits(rawResults, previewLineByPortalId);
		return hits.map((hit, i) =>
			rawResults[i]?.isLayer ? { ...hit, layer: true as const } : hit,
		);
	}, [
		query,
		scope,
		index,
		layerIndex,
		activeFileDoc,
		previewLineByPortalId,
		liveSignPaths,
		liveLayerSignPaths,
	]);

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
			className="cabn-orb-backdrop"
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				paddingTop: "12vh",
				zIndex: 7,
				pointerEvents: "auto",
				overflow: "hidden",
			}}
		>
			<div className="cabn-orb-mist" />
			<div className="cabn-orb-mist two" />
			{AMBIENT_SPARKLES.map((s, i) => (
				// Fixed, static ambient layout, never reordered — index is a stable
				// enough key, same reasoning as the open-burst lists below.
				<img
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed, static list
					key={i}
					className="cabn-sparkle"
					src={uiSparklePath(s.color)}
					alt=""
					style={{
						top: s.top,
						left: s.left,
						width: s.width,
						animationDelay: `${s.delayMs}ms`,
					}}
				/>
			))}
			{/* The literal crystal ball (ui_screen_orb, tools/asset-pipeline's
			    ui-screen-orb.ts): a pixel-art glass rim on a bronze stand, with
			    the dark swirling glass (cabn-crystal-glass) showing through its
			    transparent interior. Results sit in the art's inscribed
			    rectangle (cabn-crystal-ball-content) and the input on the stand's
			    plaque, so nothing ever clips at the sphere's round edge. */}
			<div
				key={playToken}
				className="cabn-crystal-ball"
				style={{ position: "relative", zIndex: 3 }}
			>
				<div className="cabn-crystal-glass">
					<div className="cabn-crystal-ball-mist" />
					<div className="cabn-crystal-ball-mist two" />
				</div>
				<img className="cabn-tool-frame" src={uiScreenPath("orb")} alt="" />
				<div className="cabn-crystal-ball-content">
					{scope === "world" && loading && (
						<Status text="loading the world's search index..." />
					)}
					{scope === "world" && error && (
						<Status text={`search index failed to load: ${error}`} />
					)}
					{hits.length === 0 && query.trim() && !loading && (
						<Status text="no matches" />
					)}
					{hits.length === 0 && !query.trim() && (
						<Status text="speak a query to the ball..." />
					)}
					<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
						{hits.map((hit) => (
							<SearchHitRow
								key={hit.kind === "world" ? hit.portalId : `line-${hit.line}`}
								hit={hit}
								layerLabel={layer?.label ?? null}
								onSelect={() => select(hit)}
							/>
						))}
					</ul>
				</div>
				<div className="cabn-crystal-plinth">
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							// Enter picks the top result. The game can't also act on this
							// Enter: render/keyboardFocusGate.ts turns Phaser's keyboard
							// off while a text field has focus.
							const top = hits[0];
							if (e.key === "Enter" && top && !e.nativeEvent.isComposing) {
								e.preventDefault();
								select(top);
							}
						}}
						placeholder={
							scope === "file" ? "search this file..." : "search the world..."
						}
						style={{
							width: "100%",
							font: "inherit",
							fontSize: 14,
							background: "transparent",
							border: "none",
							borderBottom: "2px dashed rgba(255,255,255,0.4)",
							outline: "none",
							color: "inherit",
							padding: "2px 2px 4px",
						}}
					/>
				</div>
				<div className="cabn-effect-burst play">
					{OPEN_BURST_SPARKS.map((s, i) => (
						// Fixed, static per-render burst layout, never reordered — index
						// is a stable enough key.
						<img
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed, static list
							key={i}
							className="cabn-spark"
							src={uiSparklePath(s.color)}
							alt=""
							style={
								{
									"--cabn-tx": `${s.tx}px`,
									"--cabn-ty": `${s.ty}px`,
									animationDelay: `${s.delayMs}ms`,
								} as React.CSSProperties
							}
						/>
					))}
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

interface SignSync {
	index: WorldSearchIndex | null;
	sources: Map<string, string>;
}

function syncSigns(
	synced: SignSync,
	index: WorldSearchIndex,
	signs: Parameters<typeof syncSignSearchDocs>[1],
): Set<string> {
	if (synced.index !== index) {
		synced.index = index;
		synced.sources = new Map();
	}
	synced.sources = syncSignSearchDocs(index, signs, synced.sources);
	return new Set(signs.map((s) => s.path));
}

function SearchHitRow({
	hit,
	layerLabel,
	onSelect,
}: {
	hit: SearchHit;
	layerLabel: string | null;
	onSelect: () => void;
}): React.ReactElement {
	const title = hit.kind === "world" ? hit.path : `line ${hit.line + 1}`;
	const snippet = hit.kind === "world" ? hit.previewLine : hit.snippet;
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				title={snippet ? `${title} — ${snippet}` : title}
				style={{
					width: "100%",
					textAlign: "left",
					background: "none",
					border: "none",
					// A light-on-dark dotted rule, not the usual dark-on-light one — this
					// row sits inside the crystal ball's dark glass, not a panelBody.
					borderBottom: "2px dotted rgba(255,255,255,0.25)",
					font: "inherit",
					padding: "8px 4px",
					cursor: "pointer",
					color: "inherit",
					display: "flex",
					flexDirection: "column",
					gap: 2,
				}}
			>
				<strong className="cabn-clip-line" style={{ fontSize: 13 }}>
					{title}
					{hit.kind === "world" && hit.layer && (
						<span className="cabn-layer-badge" data-testid="layer-badge">
							{layerLabel ?? "layer"}
						</span>
					)}
				</strong>
				{snippet && (
					<span
						className="cabn-clip-line"
						style={{ fontSize: 11, opacity: 0.75 }}
					>
						{snippet}
					</span>
				)}
			</button>
		</li>
	);
}
