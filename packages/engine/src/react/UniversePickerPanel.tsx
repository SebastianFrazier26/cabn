import {
	type GitBranchSummary,
	type HistoryRelease,
	parseReleasesFile,
	RELEASES_FILENAME,
	type ReleasesFile,
} from "@cabn/world-schema";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore, GitContext } from "../bridge/store.js";
import {
	registerMemoryWorld,
	resolveRelativeUrl,
} from "../render/resolveUrl.js";
import { loadBrowserRepo } from "../systems/git/loadRepo.js";
import {
	cssColor,
	formatCommitDate,
	shortOid,
	universeSlug,
	universeTint,
} from "../systems/gitHistory.js";
import {
	type BrowserStash,
	clearStash,
	readStash,
	savedEdits,
	writeStash,
} from "../systems/gitStash.js";
import {
	OwnerApiError,
	type OwnerCapability,
	type OwnerGitStatus,
} from "../systems/ownerApi.js";
import type { OwnerGitAction } from "../systems/ownerToolkit.js";
import { hashSeed } from "../systems/portalFx.js";
import { travelLabel } from "../systems/sceneLoading.js";
import { fetchJsonOnce } from "./gitShared.js";
import { MarkdownLite } from "./MarkdownLite.js";
import { useCabnStore } from "./useCabnStore.js";
import { useFocusTrap } from "./useFocusTrap.js";

interface Props {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
	owner?: OwnerCapability;
}

type Tab = "universes" | "releases" | "owner";

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** The rift's dialog: travel between branch universes, read tags and GitHub releases, and (owner mode only) commit and switch for real. */
/** The picker's dialog, a lazy chunk of its own: loaded the first time the rift opens (see UniversePicker.tsx). */
export function UniversePickerDialog({
	store,
	bus,
	owner,
	git,
	close,
}: Props & { git: GitContext; close: () => void }): React.ReactElement {
	// Opened from the owner's toolkit: straight to the Owner tab's flow.
	const ownerFocus = useCabnStore(store, (s) => s.universeOwnerFocus);
	const [tab, setTab] = useState<Tab>(() =>
		ownerFocus && owner?.git ? "owner" : "universes",
	);
	const tint = universeTint(git.universe?.slug ?? null);
	const dialogRef = useRef<HTMLDivElement>(null);
	useFocusTrap(dialogRef);
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
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-label="Universe picker"
				data-testid="universe-picker"
				className="cabn-panel"
				style={{
					width: "min(720px, calc(100% - 32px))",
					maxHeight: "calc(100% - 48px)",
					overflow: "auto",
					boxSizing: "border-box",
					borderColor: tint !== null ? cssColor(tint) : undefined,
				}}
			>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						gap: 8,
						alignItems: "center",
					}}
				>
					<div>
						<div
							className="cabn-panel-title"
							style={{
								textAlign: "left",
								margin: 0,
								color: "var(--cabn-text)",
							}}
						>
							The Rift of Branches
						</div>
						<div style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}>
							You are in the universe of <strong>{git.branch}</strong>
							{git.universe ? " (an alternate universe)" : " (the main world)"}.
						</div>
					</div>
					<button type="button" className="cabn-btn cancel" onClick={close}>
						Close (Esc)
					</button>
				</div>
				<div
					className="cabn-segmented"
					role="tablist"
					style={{ display: "flex", gap: 4, margin: "10px 0" }}
				>
					{(
						[
							["universes", "Universes"],
							["releases", "Tags & releases"],
							...(owner?.git ? [["owner", "Owner"]] : []),
						] as [Tab, string][]
					).map(([id, label]) => (
						<button
							key={id}
							type="button"
							role="tab"
							aria-selected={tab === id}
							className={tab === id ? "selected" : undefined}
							onClick={() => setTab(id)}
						>
							{label}
						</button>
					))}
				</div>
				{tab === "universes" && (
					<BranchList git={git} bus={bus} store={store} />
				)}
				{tab === "releases" && <ReleaseList git={git} />}
				{tab === "owner" && owner?.git && (
					<OwnerPanel
						git={git}
						owner={owner}
						bus={bus}
						store={store}
						focus={ownerFocus}
					/>
				)}
			</div>
		</div>
	);
}

/** Memory-world key: unique per main world and branch, url-safe (render/resolveUrl.ts). */
function universeKey(git: GitContext, branch: string): string {
	return `${hashSeed(git.historyBase).toString(16)}-${universeSlug(branch)}`;
}

function BranchList({
	git,
	bus,
	store,
}: {
	git: GitContext;
	bus: CabnBus;
	store: StoreApi<CabnStore>;
}): React.ReactElement {
	const [loading, setLoading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Opening the rift is when the git reader and the pack first load.
	useEffect(() => {
		loadBrowserRepo(git.historyBase, git.meta)
			.then((repo) =>
				repo.log(git.meta.branches.find((b) => b.current)?.name ?? git.branch),
			)
			.catch(() => {});
	}, [git]);

	const travel = async (branch: GitBranchSummary) => {
		if (branch.current) {
			bus.emit("universe:travel", {
				worldUrl: `${git.historyBase}world.json`,
				universe: null,
			});
			return;
		}
		setLoading(branch.name);
		setError(null);
		const universe = { slug: universeSlug(branch.name), branch: branch.name };
		// The loading panel's own label from here on, through the conversion and
		// the scene load that universe:travel starts (which begins before this
		// token ends, so the panel never drops out between them).
		const token = store.getState().beginLoading(travelLabel(universe), {
			detail: "Built here in your browser from its git history",
		});
		try {
			const repo = await loadBrowserRepo(git.historyBase, git.meta);
			const bundle = await repo.convertUniverse(branch.name, {
				name: store.getState().worldMap?.name ?? branch.name,
				source: `${git.rootSource}#${branch.name}`,
				generatedAt: git.generatedAt,
			});
			const base = registerMemoryWorld(universeKey(git, branch.name), bundle);
			bus.emit("universe:travel", {
				worldUrl: `${base}world.json`,
				universe,
			});
		} catch (e) {
			setError(`That universe couldn't be opened: ${(e as Error).message}`);
			setLoading(null);
		} finally {
			store.getState().endLoading(token);
		}
	};

	return (
		<>
			{error && (
				<div
					role="alert"
					style={{
						fontSize: 12,
						color: "var(--cabn-diff-del-text)",
						background: "var(--cabn-diff-del-bg)",
						padding: 6,
						borderRadius: 6,
						marginBottom: 6,
					}}
				>
					{error}
				</div>
			)}
			<ul
				style={{
					listStyle: "none",
					margin: 0,
					padding: 0,
					display: "grid",
					gap: 6,
				}}
			>
				{git.meta.branches.map((branch) => {
					const here = branch.name === git.branch;
					const tint = branch.current
						? null
						: universeTint(universeSlug(branch.name));
					return (
						<li
							key={branch.name}
							data-testid="universe-branch"
							data-branch={branch.name}
							style={{
								display: "flex",
								gap: 8,
								alignItems: "center",
								padding: 8,
								borderRadius: 8,
								background: here ? "var(--cabn-inset-tint)" : undefined,
								borderLeft: `6px solid ${tint !== null ? cssColor(tint) : "var(--cabn-accent-yellow)"}`,
							}}
						>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div style={{ fontWeight: 700 }}>
									{branch.name}
									{branch.current ? " · main world" : ""}
									{here ? " · you are here" : ""}
								</div>
								<div
									style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}
								>
									{shortOid(branch.head)} {formatCommitDate(branch.time)} ·{" "}
									{branch.author} · {branch.subject}
								</div>
								<div
									style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}
								>
									{branch.commits}
									{branch.truncated ? "+" : ""} commits shipped
								</div>
							</div>
							{!here && (
								<button
									type="button"
									className="cabn-btn confirm"
									disabled={loading !== null}
									aria-busy={loading === branch.name}
									data-testid={
										loading === branch.name ? "universe-loading" : undefined
									}
									onClick={() => travel(branch)}
								>
									{branch.current ? "Return" : "Travel"}
								</button>
							)}
						</li>
					);
				})}
			</ul>
		</>
	);
}

function ReleaseList({ git }: { git: GitContext }): React.ReactElement {
	const [releases, setReleases] = useState<ReleasesFile | null>(null);
	useEffect(() => {
		let live = true;
		fetchJsonOnce(resolveRelativeUrl(git.historyBase, RELEASES_FILENAME)).then(
			(json) => {
				if (live) setReleases(parseReleasesFile(json));
			},
		);
		return () => {
			live = false;
		};
	}, [git.historyBase]);
	const tags = git.meta.tags;
	const byTag = new Map((releases?.items ?? []).map((r) => [r.tagName, r]));
	const tagNames = new Set(tags.map((t) => t.name));
	const orphanReleases = (releases?.items ?? []).filter(
		(r) => !tagNames.has(r.tagName),
	);
	const note =
		releases?.source === "offline"
			? "GitHub releases weren't fetched for this build (offline)."
			: releases?.source === "unavailable"
				? "GitHub releases couldn't be fetched when this world was built."
				: null;
	return (
		<div style={{ display: "grid", gap: 8 }}>
			{note && (
				<div style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}>
					{note}
				</div>
			)}
			{tags.length === 0 && orphanReleases.length === 0 && (
				<div style={{ fontSize: 12 }}>No tags or releases yet.</div>
			)}
			{tags.map((tag) => {
				const release = byTag.get(tag.name);
				return (
					<div
						key={tag.name}
						data-testid="universe-tag"
						style={{
							padding: 8,
							borderRadius: 8,
							background: "var(--cabn-inset-tint)",
						}}
					>
						<div style={{ fontWeight: 700 }}>
							{tag.name}
							{tag.time !== undefined ? ` · ${formatCommitDate(tag.time)}` : ""}
						</div>
						<div style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}>
							commit {shortOid(tag.oid)}
							{tag.tagger ? ` · tagged by ${tag.tagger}` : ""}
						</div>
						{tag.message && (
							<div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
								{tag.message}
							</div>
						)}
						{release && <ReleaseCard release={release} />}
					</div>
				);
			})}
			{orphanReleases.map((release) => (
				<div
					key={release.tagName}
					style={{
						padding: 8,
						borderRadius: 8,
						background: "var(--cabn-inset-tint)",
					}}
				>
					<ReleaseCard release={release} />
				</div>
			))}
			{(releases?.packages.length ?? 0) > 0 && (
				<div>
					<div style={{ fontWeight: 700, marginTop: 4 }}>Packages</div>
					<ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
						{releases?.packages.map((p) => (
							<li key={`${p.packageType}:${p.name}`}>
								<a href={p.url} target="_blank" rel="noopener noreferrer">
									{p.name}
								</a>{" "}
								({p.packageType})
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function ReleaseCard({
	release,
}: {
	release: HistoryRelease;
}): React.ReactElement {
	return (
		<div data-testid="universe-release" style={{ marginTop: 6 }}>
			<div style={{ fontSize: 12 }}>
				Release <strong>{release.name || release.tagName}</strong>
				{release.prerelease ? " (pre-release)" : ""}
				{release.publishedAt ? ` · ${release.publishedAt.slice(0, 10)}` : ""} ·{" "}
				<a href={release.url} target="_blank" rel="noopener noreferrer">
					View on GitHub
				</a>
			</div>
			{release.body && <MarkdownLite source={release.body} />}
			{release.assets.length > 0 && (
				<ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12 }}>
					{release.assets.map((a) => (
						<li key={a.name}>
							<a href={a.url} target="_blank" rel="noopener noreferrer">
								{a.name}
							</a>{" "}
							({Math.max(1, Math.round(a.size / 1024))} KB)
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function OwnerPanel({
	git,
	owner,
	bus,
	store,
	focus,
}: {
	git: GitContext;
	owner: OwnerCapability;
	bus: CabnBus;
	store: StoreApi<CabnStore>;
	focus: OwnerGitAction | null;
}): React.ReactElement {
	const api = owner.git;
	const [status, setStatus] = useState<OwnerGitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [needsAuthor, setNeedsAuthor] = useState(false);
	const [authorName, setAuthorName] = useState("");
	const [authorEmail, setAuthorEmail] = useState("");
	const [newBranch, setNewBranch] = useState("");
	const [switchNewBranch, setSwitchNewBranch] = useState(true);
	const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
	const edits = useMemo(() => savedEdits(git.worldId), [git.worldId]);
	const editPaths = Object.keys(edits).sort();
	const [selected, setSelected] = useState<Set<string>>(
		() => new Set(editPaths),
	);
	const [stash, setStash] = useState<BrowserStash | null>(null);
	const storage = safeStorage();
	const sections = {
		commit: useRef<HTMLFieldSetElement>(null),
		branch: useRef<HTMLFieldSetElement>(null),
		switch: useRef<HTMLFieldSetElement>(null),
	};
	const focusSection = focus ? sections[focus] : null;
	const branchCount = status?.branches.length ?? 0;
	// Re-run once the status lands: the switch section's buttons only exist then.
	// biome-ignore lint/correctness/useExhaustiveDependencies: branchCount is the trigger, not a value read here.
	useEffect(() => {
		const section = focusSection?.current;
		if (!section) return;
		section.scrollIntoView({ block: "nearest" });
		section
			.querySelector<HTMLElement>(
				"textarea, input:not([type=checkbox]), button:not(:disabled)",
			)
			?.focus({ preventScroll: true });
	}, [focusSection, branchCount]);

	useEffect(() => {
		api
			?.status()
			.then(setStatus)
			.catch((e: unknown) => setError((e as Error).message));
		if (storage) setStash(readStash(storage, git.rootSource, git.branch));
	}, [api, storage, git.rootSource, git.branch]);

	if (!api) return <div />;
	// A universe is a prebuilt view; the real repository is the main world's.
	if (git.universe)
		return (
			<div style={{ fontSize: 12 }}>
				Owner actions work on the real repository, which is the main world.
				Return there through the Universes tab.
			</div>
		);

	/** Every owner write reloads into a reconverted world with a fresh save slot, so edits that aren't part of the write are stashed first. */
	const stashRemaining = (branch: string, keep: Record<string, string>) => {
		if (!storage || Object.keys(keep).length === 0) return;
		writeStash(storage, git.rootSource, {
			branch,
			savedAt: new Date().toISOString(),
			files: keep,
		});
	};
	const run = async (work: () => Promise<void>, label: string) => {
		setBusy(true);
		setError(null);
		// Not ended on success: the page reloads under the panel.
		const token = store.getState().beginLoading(label, {
			detail: "The real repository changes, then the world rebuilds",
		});
		try {
			await work();
			window.location.reload();
		} catch (e) {
			store.getState().endLoading(token);
			if (e instanceof OwnerApiError && e.needsAuthor) setNeedsAuthor(true);
			setError((e as Error).message);
			setBusy(false);
		}
	};
	const commit = () =>
		run(async () => {
			const files = [...selected].map((path) => ({
				path,
				content: edits[path] as string,
			}));
			await api.commit({
				message,
				files,
				...(needsAuthor
					? { author: { name: authorName, email: authorEmail } }
					: {}),
			});
			const rest = Object.fromEntries(
				Object.entries(edits).filter(([path]) => !selected.has(path)),
			);
			stashRemaining(git.branch, rest);
		}, "Sealing the commit…");
	const createBranch = () =>
		run(async () => {
			await api.createBranch({ name: newBranch, checkout: switchNewBranch });
			// Like git, uncommitted edits follow you onto a branch created from here.
			stashRemaining(switchNewBranch ? newBranch : git.branch, edits);
		}, `Growing the branch ${newBranch}…`);
	const switchTo = (branch: string) =>
		run(async () => {
			await api.checkout({ branch });
			stashRemaining(git.branch, edits);
		}, `Switching to ${branch}…`);
	const restoreStash = () => {
		if (!stash || !storage) return;
		clearStash(storage, git.rootSource, git.branch);
		bus.emit("universe:travel", {
			worldUrl: `${git.historyBase}world.json`,
			universe: null,
			restoreOverrides: stash.files,
		});
	};

	return (
		<div
			data-testid="owner-panel"
			style={{ display: "grid", gap: 10, fontSize: 12 }}
		>
			<div>
				Checked out: <strong>{status?.branch ?? "…"}</strong>
				{status && status.dirtyCount > 0
					? ` · ${status.dirtyCount} uncommitted change(s) on disk`
					: ""}
				{status?.author ? ` · committing as ${status.author.name}` : ""}
			</div>
			{error && (
				<div
					role="alert"
					data-testid="owner-error"
					style={{
						color: "var(--cabn-diff-del-text)",
						background: "var(--cabn-diff-del-bg)",
						padding: 6,
						borderRadius: 6,
					}}
				>
					{error}
				</div>
			)}
			{stash && (
				<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span>
						{Object.keys(stash.files).length} stashed edit(s) from this branch
						are waiting in this browser.
					</span>
					<button
						type="button"
						className="cabn-btn neutral"
						disabled={busy}
						onClick={restoreStash}
					>
						Restore stash
					</button>
				</div>
			)}
			<fieldset
				ref={sections.commit}
				data-owner-section="commit"
				data-focused={focus === "commit" ? "true" : undefined}
				style={sectionStyle(focus === "commit")}
			>
				<legend>Commit my saved edits</legend>
				{editPaths.length === 0 ? (
					<div>
						No saved edits in this world yet. Edit a file and save it first.
					</div>
				) : (
					<>
						{editPaths.map((path) => (
							<label key={path} style={{ display: "block" }}>
								<input
									type="checkbox"
									checked={selected.has(path)}
									onChange={(e) => {
										const next = new Set(selected);
										if (e.target.checked) next.add(path);
										else next.delete(path);
										setSelected(next);
									}}
								/>{" "}
								{path}
							</label>
						))}
						<textarea
							aria-label="Commit message"
							data-testid="owner-commit-message"
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							placeholder="Commit message"
							rows={2}
							style={{
								width: "100%",
								boxSizing: "border-box",
								marginTop: 6,
								fontFamily: "var(--cabn-font-mono)",
							}}
						/>
						{(needsAuthor || !status?.author) && (
							<div style={{ display: "flex", gap: 6, marginTop: 4 }}>
								<input
									aria-label="Author name"
									placeholder="Your name"
									value={authorName}
									onChange={(e) => {
										setAuthorName(e.target.value);
										setNeedsAuthor(true);
									}}
								/>
								<input
									aria-label="Author email"
									placeholder="you@example.com"
									value={authorEmail}
									onChange={(e) => {
										setAuthorEmail(e.target.value);
										setNeedsAuthor(true);
									}}
								/>
							</div>
						)}
						<div style={{ marginTop: 6, color: "var(--cabn-text-secondary)" }}>
							Unticked edits are stashed in this browser and offered back here.
							Nothing is pushed anywhere.
						</div>
						<button
							type="button"
							className="cabn-btn confirm"
							style={{ marginTop: 6 }}
							disabled={busy || selected.size === 0 || message.trim() === ""}
							onClick={commit}
						>
							Commit {selected.size} file(s)
						</button>
					</>
				)}
			</fieldset>
			<fieldset
				ref={sections.branch}
				data-owner-section="branch"
				data-focused={focus === "branch" ? "true" : undefined}
				style={sectionStyle(focus === "branch")}
			>
				<legend>New branch from here</legend>
				<input
					aria-label="New branch name"
					data-testid="owner-branch-name"
					value={newBranch}
					onChange={(e) => setNewBranch(e.target.value)}
					placeholder="feature/my-idea"
				/>{" "}
				<label>
					<input
						type="checkbox"
						checked={switchNewBranch}
						onChange={(e) => setSwitchNewBranch(e.target.checked)}
					/>{" "}
					switch to it
				</label>{" "}
				<button
					type="button"
					className="cabn-btn neutral"
					disabled={busy || newBranch.trim() === ""}
					onClick={createBranch}
				>
					Create
				</button>
			</fieldset>
			<fieldset
				ref={sections.switch}
				data-owner-section="switch"
				data-focused={focus === "switch" ? "true" : undefined}
				style={sectionStyle(focus === "switch")}
			>
				<legend>Switch branch (real checkout)</legend>
				{(status?.branches ?? [])
					.filter((b) => b !== status?.branch)
					.map((b) => (
						<button
							key={b}
							type="button"
							className="cabn-btn neutral"
							style={{ margin: 2 }}
							disabled={busy}
							onClick={() =>
								editPaths.length > 0 ? setPendingSwitch(b) : switchTo(b)
							}
						>
							{b}
						</button>
					))}
				{pendingSwitch && (
					<div
						role="alert"
						data-testid="owner-switch-warning"
						style={{ marginTop: 6 }}
					>
						You have {editPaths.length} saved edit(s) that aren't committed.
						Switching stashes them in this browser under{" "}
						<strong>{git.branch}</strong>; they come back when you return to it.{" "}
						<button
							type="button"
							className="cabn-btn confirm"
							disabled={busy}
							onClick={() => switchTo(pendingSwitch)}
						>
							Stash &amp; switch
						</button>{" "}
						<button
							type="button"
							className="cabn-btn cancel"
							onClick={() => setPendingSwitch(null)}
						>
							Cancel
						</button>
					</div>
				)}
			</fieldset>
		</div>
	);
}

function sectionStyle(focused: boolean): React.CSSProperties {
	return {
		border: `2px solid var(${focused ? "--cabn-accent-yellow" : "--cabn-border-outer"})`,
		borderRadius: 8,
	};
}
