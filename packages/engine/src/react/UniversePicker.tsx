import type {
	HistoryBranch,
	HistoryIndexFile,
	HistoryRelease,
} from "@cabn/world-schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore, GitContext } from "../bridge/store.js";
import {
	bundleUrl,
	commitSubject,
	commitsByOid,
	cssColor,
	formatCommitDate,
	shortOid,
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
import { useModalKeys } from "./gitShared.js";
import { MarkdownLite } from "./MarkdownLite.js";
import { useCabnStore } from "./useCabnStore.js";

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
export function UniversePicker({
	store,
	bus,
	owner,
}: Props): React.ReactElement | null {
	const open = useCabnStore(store, (s) => s.universeOpen);
	const git = useCabnStore(store, (s) => s.git);
	const mode = useCabnStore(store, (s) => s.mode);
	const [tab, setTab] = useState<Tab>("universes");
	const close = useCallback(
		() => store.getState().setUniverseOpen(false),
		[store],
	);
	useModalKeys(open, close);
	if (!open || !git || mode !== "world") return null;
	const tint = universeTint(git.universe?.slug ?? null);
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
				{tab === "universes" && <BranchList git={git} bus={bus} />}
				{tab === "releases" && <ReleaseList history={git.history} />}
				{tab === "owner" && owner?.git && (
					<OwnerPanel git={git} owner={owner} bus={bus} />
				)}
			</div>
		</div>
	);
}

function travelUrl(git: GitContext, branch: HistoryBranch): string | null {
	if (branch.current) return `${git.historyBase}world.json`;
	return branch.universe
		? bundleUrl(git.historyBase, branch.universe.worldUrl, "universe")
		: null;
}

function BranchList({
	git,
	bus,
}: {
	git: GitContext;
	bus: CabnBus;
}): React.ReactElement {
	const byOid = useMemo(() => commitsByOid(git.history), [git.history]);
	return (
		<ul
			style={{
				listStyle: "none",
				margin: 0,
				padding: 0,
				display: "grid",
				gap: 6,
			}}
		>
			{git.history.branches.map((branch) => {
				const here = branch.name === git.branch;
				const head = byOid.get(branch.head);
				const url = travelUrl(git, branch);
				const tint = universeTint(branch.universe?.slug ?? null);
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
							{head && (
								<div
									style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}
								>
									{shortOid(head.oid)} {formatCommitDate(head.time)} ·{" "}
									{head.author} · {commitSubject(head)}
								</div>
							)}
							<div
								style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}
							>
								{branch.commits.length}
								{branch.truncated ? "+" : ""} commits
								{!url && !branch.current
									? branch.universeSkipped === "over-budget"
										? " · history only (over the size budget)"
										: branch.universeSkipped === "failed"
											? " · history only (couldn't be built)"
											: " · history only (not prebuilt)"
									: ""}
							</div>
						</div>
						{url && !here && (
							<button
								type="button"
								className="cabn-btn confirm"
								onClick={() =>
									bus.emit("universe:travel", {
										worldUrl: url,
										universe:
											branch.current || !branch.universe
												? null
												: { slug: branch.universe.slug, branch: branch.name },
									})
								}
							>
								{branch.current ? "Return" : "Travel"}
							</button>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function ReleaseList({
	history,
}: {
	history: HistoryIndexFile;
}): React.ReactElement {
	const byOid = useMemo(() => commitsByOid(history), [history]);
	const releases = new Map(history.releases.items.map((r) => [r.tagName, r]));
	const tagNames = new Set(history.tags.map((t) => t.name));
	const orphanReleases = history.releases.items.filter(
		(r) => !tagNames.has(r.tagName),
	);
	const note =
		history.releases.source === "offline"
			? "GitHub releases weren't fetched for this build (offline)."
			: history.releases.source === "unavailable"
				? "GitHub releases couldn't be fetched when this world was built."
				: null;
	return (
		<div style={{ display: "grid", gap: 8 }}>
			{note && (
				<div style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}>
					{note}
				</div>
			)}
			{history.tags.length === 0 && orphanReleases.length === 0 && (
				<div style={{ fontSize: 12 }}>No tags or releases yet.</div>
			)}
			{history.tags.map((tag) => {
				const commit = byOid.get(tag.oid);
				const release = releases.get(tag.name);
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
							{commit ? ` · ${formatCommitDate(commit.time)}` : ""}
						</div>
						{commit && (
							<div
								style={{ fontSize: 11, color: "var(--cabn-text-secondary)" }}
							>
								{shortOid(commit.oid)} {commitSubject(commit)}
							</div>
						)}
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
			{history.releases.packages.length > 0 && (
				<div>
					<div style={{ fontWeight: 700, marginTop: 4 }}>Packages</div>
					<ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
						{history.releases.packages.map((p) => (
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
}: {
	git: GitContext;
	owner: OwnerCapability;
	bus: CabnBus;
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
	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await work();
			window.location.reload();
		} catch (e) {
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
		});
	const createBranch = () =>
		run(async () => {
			await api.createBranch({ name: newBranch, checkout: switchNewBranch });
			// Like git, uncommitted edits follow you onto a branch created from here.
			stashRemaining(switchNewBranch ? newBranch : git.branch, edits);
		});
	const switchTo = (branch: string) =>
		run(async () => {
			await api.checkout({ branch });
			stashRemaining(git.branch, edits);
		});
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
				style={{
					border: "2px solid var(--cabn-border-outer)",
					borderRadius: 8,
				}}
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
				style={{
					border: "2px solid var(--cabn-border-outer)",
					borderRadius: 8,
				}}
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
				style={{
					border: "2px solid var(--cabn-border-outer)",
					borderRadius: 8,
				}}
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
