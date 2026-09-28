import {
	type HistoryCommitDiffFile,
	type HistoryHunk,
	parseHistoryCommitDiff,
} from "@cabn/world-schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore, GitContext } from "../bridge/store.js";
import {
	bundleUrl,
	commitSubject,
	DIFF_STATE_LABEL,
	type FileTimelineEntry,
	fileTimeline,
	formatCommitDate,
	rebuildVersion,
	shortOid,
} from "../systems/gitHistory.js";
import { activeFocusOwner } from "../systems/uiFocus.js";
import { DiffView } from "./DiffView.js";
import { fetchJsonOnce, useModalKeys } from "./gitShared.js";
import { useCabnStore } from "./useCabnStore.js";

interface Props {
	store: StoreApi<CabnStore>;
}

async function loadHunks(
	git: GitContext,
	entry: FileTimelineEntry,
	path: string,
): Promise<HistoryHunk[] | null> {
	if (entry.change.diff !== "included" || !entry.commit.diffFile) return null;
	const url = bundleUrl(git.historyBase, entry.commit.diffFile, "diff");
	if (!url) return null;
	const diff: HistoryCommitDiffFile | null = parseHistoryCommitDiff(
		await fetchJsonOnce(url),
	);
	return diff?.files.find((f) => f.path === path)?.hunks ?? null;
}

async function loadWorldText(
	worldBase: string,
	clusterId: string,
	path: string,
): Promise<string | null> {
	const chunk = (await fetchJsonOnce(
		`${worldBase}chunks/${encodeURIComponent(clusterId)}.json`,
	)) as { files?: Record<string, { content?: unknown }> } | null;
	const content = chunk?.files?.[path]?.content;
	return typeof content === "string" ? content : null;
}

/**
 * The pensieve: one file's memories. A timeline of the commits (on this
 * universe's branch) that touched it, each change's diff, and — where every
 * newer diff is present — the file as it stood after that commit, rebuilt in
 * the browser by undoing the newer diffs from the world's own copy.
 *
 * Opened with H at an arch (world) or Alt/Option+H inside a file.
 */
export function Pensieve({ store }: Props): React.ReactElement | null {
	const portalId = useCabnStore(store, (s) => s.pensievePortalId);
	const git = useCabnStore(store, (s) => s.git);
	const close = useCallback(
		() => store.getState().setPensievePortalId(null),
		[store],
	);
	useModalKeys(portalId !== null, close);
	usePensieveHotkeys(store);
	if (!portalId || !git) return null;
	return (
		<PensievePanel
			key={`${git.worldId}:${portalId}`}
			store={store}
			git={git}
			path={portalId}
			onClose={close}
		/>
	);
}

function usePensieveHotkeys(store: StoreApi<CabnStore>): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.code !== "KeyH" ||
				event.metaKey ||
				event.ctrlKey ||
				event.repeat
			)
				return;
			const s = store.getState();
			if (!s.git || s.pensievePortalId !== null) return;
			let target: string | null = null;
			// Inside a file letters type, so it's the Alt chord there (by physical key, like the other file-view tools).
			if (s.mode === "file" && event.altKey) target = s.activePortalId;
			else if (
				s.mode === "world" &&
				!event.altKey &&
				!s.mapOpen &&
				!s.guideOpen &&
				!s.universeOpen &&
				activeFocusOwner() !== "text"
			)
				target = s.focusedPortalPreview?.portalId ?? null;
			if (!target) return;
			event.preventDefault();
			event.stopPropagation();
			s.setPensievePortalId(target);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
}

function PensievePanel({
	store,
	git,
	path,
	onClose,
}: {
	store: StoreApi<CabnStore>;
	git: GitContext;
	path: string;
	onClose: () => void;
}): React.ReactElement {
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const portal = useCabnStore(store, (s) =>
		s.portals.find((p) => p.id === path),
	);
	const timeline = useMemo(
		() => fileTimeline(git.history, git.branch, path),
		[git.history, git.branch, path],
	);
	const [selected, setSelected] = useState(0);
	const [hunks, setHunks] = useState<HistoryHunk[] | null | undefined>(
		undefined,
	);
	const [version, setVersion] = useState<{
		index: number;
		text: string | null;
	} | null>(null);
	const entry = timeline[selected];

	useEffect(() => {
		setHunks(undefined);
		setVersion(null);
		if (!entry) return;
		let live = true;
		loadHunks(git, entry, path).then((h) => {
			if (live) setHunks(h);
		});
		return () => {
			live = false;
		};
	}, [git, entry, path]);

	// Only the main world's shipped text can differ from HEAD; a universe is its branch head exactly.
	const dirty = git.universe === null && git.history.dirtyPaths.includes(path);

	const showVersion = async () => {
		if (!worldBase || !portal) return;
		const current = await loadWorldText(worldBase, portal.clusterId, path);
		if (current === null || dirty) {
			setVersion({ index: selected, text: null });
			return;
		}
		const steps = await Promise.all(
			timeline.slice(0, selected).map((e) => loadHunks(git, e, path)),
		);
		setVersion({ index: selected, text: rebuildVersion(current, steps) });
	};

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				zIndex: 13,
				pointerEvents: "auto",
				background: "#0009",
				display: "grid",
				placeItems: "center",
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Pensieve"
				data-testid="pensieve"
				className="cabn-panel"
				style={{
					width: "min(900px, calc(100% - 32px))",
					height: "min(620px, calc(100% - 48px))",
					boxSizing: "border-box",
					display: "flex",
					flexDirection: "column",
					gap: 8,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						gap: 8,
					}}
				>
					<div>
						<div
							className="cabn-panel-title"
							style={{ textAlign: "left", margin: 0 }}
						>
							Pensieve · {path}
						</div>
						<div style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}>
							Memories from the <strong>{git.branch}</strong> universe
						</div>
					</div>
					<button type="button" className="cabn-btn cancel" onClick={onClose}>
						Close (Esc)
					</button>
				</div>
				{timeline.length === 0 ? (
					<div style={{ fontSize: 12 }}>
						No commit in the recent history touched this file
						{dirty ? " (it may be new and not committed yet)" : ""}.
					</div>
				) : (
					<div style={{ display: "flex", gap: 10, minHeight: 0, flex: 1 }}>
						<ol
							data-testid="pensieve-timeline"
							style={{
								listStyle: "none",
								margin: 0,
								padding: 0,
								width: 260,
								overflowY: "auto",
								flexShrink: 0,
							}}
						>
							{timeline.map((e, i) => (
								<li key={e.commit.oid}>
									<button
										type="button"
										data-testid="pensieve-entry"
										aria-pressed={i === selected}
										onClick={() => setSelected(i)}
										style={{
											width: "100%",
											textAlign: "left",
											font: "inherit",
											fontSize: 11,
											padding: 6,
											marginBottom: 4,
											cursor: "pointer",
											color: "var(--cabn-text)",
											background:
												i === selected
													? "var(--cabn-inset-tint)"
													: "transparent",
											border: `2px solid ${i === selected ? "var(--cabn-border-outer)" : "transparent"}`,
											borderRadius: 8,
										}}
									>
										<div style={{ fontWeight: 700 }}>
											{commitSubject(e.commit)}
										</div>
										<div style={{ color: "var(--cabn-text-secondary)" }}>
											{formatCommitDate(e.commit.time)} · {e.commit.author} ·{" "}
											{shortOid(e.commit.oid)}
										</div>
										<div>
											{e.change.status}
											{e.change.additions !== undefined
												? ` · +${e.change.additions} −${e.change.deletions ?? 0}`
												: ""}
										</div>
									</button>
								</li>
							))}
						</ol>
						<div
							style={{
								flex: 1,
								minWidth: 0,
								display: "flex",
								flexDirection: "column",
								gap: 6,
							}}
						>
							{entry && (
								<div
									style={{
										fontSize: 12,
										whiteSpace: "pre-wrap",
										maxHeight: 64,
										overflow: "auto",
									}}
								>
									{entry.commit.message}
								</div>
							)}
							{entry && entry.change.diff !== "included" ? (
								<div
									data-testid="pensieve-sealed"
									style={{
										fontSize: 12,
										padding: 8,
										background: "var(--cabn-inset-tint)",
										borderRadius: 8,
									}}
								>
									{DIFF_STATE_LABEL[entry.change.diff]}
								</div>
							) : hunks === undefined ? (
								<div style={{ fontSize: 12 }}>Stirring the memory…</div>
							) : hunks === null ? (
								<div style={{ fontSize: 12 }}>
									This memory couldn't be read.
								</div>
							) : version?.index === selected ? (
								version.text === null ? (
									<div
										data-testid="pensieve-version-unavailable"
										style={{ fontSize: 12 }}
									>
										This version can't be rebuilt:{" "}
										{dirty
											? "the world's copy has uncommitted changes."
											: "a newer change is withheld or missing."}
									</div>
								) : (
									<pre
										data-testid="pensieve-version"
										style={{
											margin: 0,
											flex: 1,
											overflow: "auto",
											fontFamily: "var(--cabn-font-mono)",
											fontSize: 12,
											border: "2px solid var(--cabn-border-outer)",
											borderRadius: 8,
											padding: 8,
										}}
									>
										{version.text}
									</pre>
								)
							) : (
								<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
									<div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
										<DiffView hunks={hunks} />
									</div>
								</div>
							)}
							{entry && entry.change.status !== "deleted" && (
								<div style={{ display: "flex", gap: 6 }}>
									{version?.index === selected ? (
										<button
											type="button"
											className="cabn-btn neutral"
											onClick={() => setVersion(null)}
										>
											Show the change
										</button>
									) : (
										<button
											type="button"
											className="cabn-btn neutral"
											data-testid="pensieve-show-version"
											onClick={showVersion}
										>
											Show the file at this commit
										</button>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
