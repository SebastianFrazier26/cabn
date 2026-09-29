import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { toCssColor } from "../palette.js";
import { isRepoLoaded, loadBrowserRepo } from "../systems/git/loadRepo.js";
import type { CommitChanges, RepoCommit } from "../systems/git/types.js";
import { activeFocusOwner, classifyFocus } from "../systems/uiFocus.js";
import { LAYER_FALLBACK_COLOR } from "../systems/worldLayer.js";
import { mapProjection, type WorldMapSummary } from "../systems/worldMap.js";
import { useCabnStore } from "./useCabnStore.js";

// Only a world with git history ever shows it, and only after the reader loads.
const MapTimeline = lazy(() =>
	import("./MapTimeline.js").then((m) => ({ default: m.MapTimeline })),
);

interface Props {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

export function WorldMap({ store, bus }: Props): React.ReactElement | null {
	const map = useCabnStore(store, (s) => s.worldMap);
	const mode = useCabnStore(store, (s) => s.mode);
	const open = useCabnStore(store, (s) => s.mapOpen);
	const closeRef = useRef<HTMLButtonElement>(null);
	const git = useCabnStore(store, (s) => s.git);
	// null until the git reader loads (lazily: the map itself never pulls the pack in).
	const [commits, setCommits] = useState<RepoCommit[] | null>(null);
	const [loadingTimeline, setLoadingTimeline] = useState(false);
	// Slider position counts from the oldest commit (left) to the newest (right); null = timeline off.
	const [step, setStep] = useState<number | null>(null);
	const [changes, setChanges] = useState<CommitChanges | null>(null);
	const loadTimeline = useMemo(
		() => () => {
			if (!git) return;
			setLoadingTimeline(true);
			loadBrowserRepo(git.historyBase, git.meta)
				.then((repo) => repo.log(git.branch))
				.then(setCommits)
				.catch(() => setCommits([]))
				.finally(() => setLoadingTimeline(false));
		},
		[git],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the map opens/closes or the universe changes.
	useEffect(() => {
		setStep(null);
		setCommits(null);
		if (open && git && isRepoLoaded(git.historyBase)) loadTimeline();
	}, [open, git]);
	const selectedCommit =
		step === null || !commits ? undefined : commits[commits.length - 1 - step];
	useEffect(() => {
		setChanges(null);
		if (!selectedCommit || !git) return;
		let live = true;
		loadBrowserRepo(git.historyBase, git.meta)
			.then((repo) => repo.changes(selectedCommit))
			.then((c) => live && setChanges(c));
		return () => {
			live = false;
		};
	}, [selectedCommit, git]);
	const highlight = useMemo(
		() => new Set(changes?.changes.map((c) => c.path) ?? []),
		[changes],
	);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const state = store.getState();
			if (event.metaKey || event.ctrlKey || event.altKey) {
				if (state.mapOpen) event.stopPropagation();
				return;
			}
			if (state.mapOpen && event.key !== "Tab") {
				event.stopPropagation();
				// The timeline slider moves with the arrow keys natively.
				const onSlider =
					(event.target as HTMLElement | null)?.getAttribute?.("type") ===
						"range" && /^(Arrow|Home$|End$|Page)/.test(event.key);
				if (event.key !== "Enter" && event.key !== " " && !onSlider)
					event.preventDefault();
				if (
					!event.repeat &&
					(event.key === "Escape" || event.key.toLowerCase() === "m")
				)
					state.setMapOpen(false);
				return;
			}
			if (
				event.defaultPrevented ||
				event.repeat ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey
			)
				return;
			if (state.mode !== "world" || !state.worldMap || state.guideOpen) return;
			if (
				activeFocusOwner() === "text" ||
				classifyFocus(event.target as HTMLElement) === "text"
			)
				return;
			if (
				event.key.toLowerCase() !== "m" &&
				!(state.mapOpen && event.key === "Escape")
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			state.setMapOpen(!state.mapOpen);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [store]);
	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		closeRef.current?.focus();
		return () => {
			previous?.focus();
		};
	}, [open]);
	if (!map || mode !== "world") return null;
	return (
		<>
			<div
				className="cabn-panel"
				data-testid="world-minimap"
				style={{
					position: "absolute",
					right: 16,
					top: 66,
					width: "min(200px, calc(100% - 32px))",
					zIndex: 5,
					pointerEvents: "auto",
				}}
			>
				<button
					type="button"
					className="cabn-btn neutral"
					style={{ width: "100%" }}
					onClick={(e) => {
						store.getState().setMapOpen(true);
						e.currentTarget.blur();
					}}
				>
					Map (M)
				</button>
				<MapDrawing map={map} store={store} bus={bus} large={false} />
			</div>
			{open && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						zIndex: 12,
						pointerEvents: "auto",
						background: "#0008",
						display: "grid",
						placeItems: "center",
					}}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="World map"
						data-testid="world-map"
						className="cabn-panel"
						style={{
							width: "min(760px, calc(100% - 32px))",
							maxHeight: "calc(100% - 32px)",
							overflow: "auto",
						}}
						onKeyDown={(e) => {
							if (e.key === "Tab") {
								const buttons = Array.from(
									e.currentTarget.querySelectorAll<HTMLElement>(
										"button, input",
									),
								);
								const index = buttons.indexOf(
									document.activeElement as HTMLElement,
								);
								e.preventDefault();
								buttons[
									(index + (e.shiftKey ? -1 : 1) + buttons.length) %
										buttons.length
								]?.focus();
							}
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								padding: 8,
							}}
						>
							<span>{map.name}</span>
							<button
								ref={closeRef}
								type="button"
								className="cabn-btn cancel"
								onClick={() => store.getState().setMapOpen(false)}
							>
								Close (Esc)
							</button>
						</div>
						<MapDrawing
							map={map}
							store={store}
							bus={bus}
							large
							highlight={highlight}
						/>
						{git && commits === null && (
							<div
								data-testid="map-timeline"
								style={{ padding: "0 12px 8px", fontSize: 12 }}
							>
								<button
									type="button"
									className="cabn-btn neutral"
									data-testid="map-timeline-load"
									disabled={loadingTimeline}
									onClick={loadTimeline}
								>
									{loadingTimeline
										? "Reading the history…"
										: "Show the commit timeline"}
								</button>
							</div>
						)}
						{commits && commits.length > 0 && (
							<Suspense fallback={null}>
								<MapTimeline
									commits={commits}
									changes={changes}
									step={step}
									setStep={setStep}
									worldPaths={map.portals}
								/>
							</Suspense>
						)}
						<p style={{ padding: "0 12px", fontSize: 12 }}>
							Gold: you · cyan squares: files · red: undefeated monsters ·
							violet diamond: the rift (git history) · bright clearings:
							visited. Select a file to walk there.
						</p>
						<fieldset
							aria-label="Map destinations"
							style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 8 }}
						>
							{map.portals.map((p) => (
								<button
									type="button"
									className="cabn-btn neutral"
									key={p.id}
									onClick={() => {
										store.getState().setMapOpen(false);
										bus.emit("tool:walk-to-portal", { portalId: p.id });
									}}
								>
									{p.label}
								</button>
							))}
						</fieldset>
					</div>
				</div>
			)}
		</>
	);
}

function MapDrawing({
	map,
	store,
	bus,
	large,
	highlight,
}: Props & {
	map: WorldMapSummary;
	large: boolean;
	highlight?: ReadonlySet<string>;
}): React.ReactElement {
	const player = useCabnStore(store, (s) => s.playerPos);
	const rift = useCabnStore(store, (s) => s.riftPos);
	const visited = useCabnStore(store, (s) => s.visitedClusterIds);
	const defeated = useCabnStore(store, (s) => s.defeatedMonsterIds);
	const layerTokens = useCabnStore(store, (s) => s.layerUiTokens);
	const layerColor = toCssColor(
		layerTokens?.accentPink ?? LAYER_FALLBACK_COLOR,
	);
	const width = large ? 720 : 200;
	const height = large ? 400 : 140;
	const project = useMemo(
		() => mapProjection(map, width, height),
		[map, width, height],
	);
	const pos = project(player);
	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={large ? "World layout" : "Minimap layout"}
			style={{
				display: "block",
				width: "100%",
				background: "var(--cabn-bg-panel, #24352b)",
			}}
		>
			{map.paths.map((p) => {
				const from = project(p.from);
				const to = project(p.to);
				return (
					<line
						key={`${p.from.x}:${p.from.y}:${p.to.x}:${p.to.y}:${p.kind}`}
						x1={from.x}
						y1={from.y}
						x2={to.x}
						y2={to.y}
						stroke={p.layer ? layerColor : "#b3a178"}
						strokeWidth={large ? 3 : 1}
						strokeDasharray={p.kind === "import" ? "4 3" : undefined}
					/>
				);
			})}
			{map.clusters.map((c) => {
				const p = project(c.pos);
				return (
					<g key={c.id}>
						<circle
							cx={p.x}
							cy={p.y}
							r={large ? 24 : 9}
							fill={visited.includes(c.id) ? "#668763" : "#354a3d"}
							stroke={c.layer ? layerColor : "#a1b58b"}
							strokeWidth={c.layer ? 3 : 1}
							data-layer={c.layer ? "" : undefined}
						/>
						<title>
							{c.label}
							{visited.includes(c.id) ? " (visited)" : " (unvisited)"}
						</title>
						{large && (
							<text
								x={p.x}
								y={p.y - 28}
								textAnchor="middle"
								fill="#f4ead2"
								fontSize={12}
							>
								{c.label}
							</text>
						)}
					</g>
				);
			})}
			{map.portals.map((p) => {
				const point = project(p.pos);
				const changed = highlight?.has(p.id) ?? false;
				return (
					<g key={p.id}>
						{changed && (
							<circle
								data-testid="map-portal-changed"
								data-portal-id={p.id}
								cx={point.x}
								cy={point.y}
								r={11}
								fill="none"
								stroke="#ffd23f"
								strokeWidth={3}
							/>
						)}
						{/* biome-ignore lint/a11y/useSemanticElements: SVG markers cannot contain HTML buttons; matching HTML destinations are below. */}
						<rect
							role="button"
							aria-label={`Walk to ${p.label}`}
							tabIndex={-1}
							onKeyDown={(e) => {
								if (e.key !== "Enter" && e.key !== " ") return;
								e.preventDefault();
								store.getState().setMapOpen(false);
								bus.emit("tool:walk-to-portal", { portalId: p.id });
							}}
							data-testid={large ? "map-portal" : undefined}
							data-portal-id={p.id}
							data-layer={p.layer ? "" : undefined}
							x={point.x - 5}
							y={point.y - 5}
							width={10}
							height={10}
							fill={p.layer ? layerColor : "#71d6d9"}
							style={{ cursor: "pointer" }}
							onClick={() => {
								if (store.getState().guideOpen) return;
								store.getState().setMapOpen(false);
								bus.emit("tool:walk-to-portal", { portalId: p.id });
							}}
						/>
						<title>{p.label}</title>
					</g>
				);
			})}
			{map.monsters
				.filter((m) => !defeated.includes(m.id))
				.map((m) => {
					const p = project(m.pos);
					return (
						<g key={m.id}>
							<circle
								data-testid={large ? "map-monster" : undefined}
								cx={p.x + 7}
								cy={p.y - 7}
								r={large ? 4 : 2}
								fill="#ed7770"
							/>
							<title>{m.label}</title>
						</g>
					);
				})}
			{rift &&
				(() => {
					const r = project(rift);
					const size = large ? 8 : 4;
					return (
						<polygon
							data-testid={large ? "map-rift" : undefined}
							points={`${r.x},${r.y - size} ${r.x + size},${r.y} ${r.x},${r.y + size} ${r.x - size},${r.y}`}
							fill="#8a6fd6"
							stroke="#f1ecff"
							strokeWidth={1}
						>
							<title>The rift of branches</title>
						</polygon>
					);
				})()}
			<circle
				data-testid={large ? "map-player" : "minimap-player"}
				cx={pos.x}
				cy={pos.y}
				r={large ? 6 : 4}
				fill="#ffd86b"
				stroke="#372811"
				strokeWidth={2}
			>
				<title>You are here</title>
			</circle>
		</svg>
	);
}
