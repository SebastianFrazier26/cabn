import { diffText, type HistoryHunk } from "@cabn/converter/browser";
import { useEffect, useState } from "react";
import type { GitContext } from "../bridge/store.js";
import { loadBrowserRepo } from "../systems/git/loadRepo.js";
import type {
	BlobRead,
	BrowserRepo,
	FileHistoryEntry,
} from "../systems/git/types.js";
import {
	commitSubject,
	formatCommitDate,
	NOT_SHIPPED_LABEL,
	shortOid,
} from "../systems/gitHistory.js";
import { DiffView } from "./DiffView.js";
import { LoadingSwirl } from "./LoadingSwirl.js";

type EntryView =
	| { kind: "loading" }
	| { kind: "diff"; hunks: HistoryHunk[] }
	| { kind: "message"; text: string; testId: string };

const EMPTY: BlobRead = { kind: "text", text: "" };

/** Old and new side of one change, read from the shipped objects and diffed here. */
async function entryView(
	repo: BrowserRepo,
	entry: FileHistoryEntry,
): Promise<EntryView> {
	const [before, after] = await Promise.all([
		entry.parentBlob ? repo.readBlob(entry.parentBlob) : Promise.resolve(EMPTY),
		entry.blob ? repo.readBlob(entry.blob) : Promise.resolve(EMPTY),
	]);
	for (const side of [after, before]) {
		if (side.kind === "not-shipped")
			return {
				kind: "message",
				text: NOT_SHIPPED_LABEL[side.reason],
				testId: "pensieve-not-shipped",
			};
	}
	if (before.kind === "binary" || after.kind === "binary")
		return {
			kind: "message",
			text: "A binary file changed.",
			testId: "pensieve-binary",
		};
	const diff = diffText(
		before.kind === "text" ? before.text : "",
		after.kind === "text" ? after.text : "",
	);
	if (!diff)
		return {
			kind: "message",
			text: "This change is too large to show as a diff.",
			testId: "pensieve-too-large",
		};
	return { kind: "diff", hunks: diff.hunks };
}

/** The pensieve dialog, a lazy chunk of its own (see Pensieve.tsx). */
export function PensievePanel({
	git,
	path,
	onClose,
}: {
	git: GitContext;
	path: string;
	onClose: () => void;
}): React.ReactElement {
	const [repo, setRepo] = useState<BrowserRepo | null>(null);
	const [timeline, setTimeline] = useState<FileHistoryEntry[] | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const [view, setView] = useState<EntryView>({ kind: "loading" });
	const [version, setVersion] = useState<{
		index: number;
		read: BlobRead;
	} | null>(null);

	useEffect(() => {
		let live = true;
		loadBrowserRepo(git.historyBase, git.meta)
			.then(async (r) => {
				const t = await r.fileHistory(git.branch, path);
				if (!live) return;
				setRepo(r);
				setTimeline(t);
			})
			.catch((e: unknown) => live && setFailed((e as Error).message));
		return () => {
			live = false;
		};
	}, [git, path]);

	const entry = timeline?.[selected];
	useEffect(() => {
		setView({ kind: "loading" });
		setVersion(null);
		if (!repo || !entry) return;
		let live = true;
		entryView(repo, entry).then((v) => live && setView(v));
		return () => {
			live = false;
		};
	}, [repo, entry]);

	const showVersion = async () => {
		if (!repo || !entry?.blob) return;
		setVersion({ index: selected, read: await repo.readBlob(entry.blob) });
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
							style={{
								textAlign: "left",
								margin: 0,
								color: "var(--cabn-text)",
							}}
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
				{failed ? (
					<div style={{ fontSize: 12 }}>
						The memories couldn't be read: {failed}
					</div>
				) : timeline === null ? (
					<div style={{ display: "grid", placeItems: "center", flex: 1 }}>
						<LoadingSwirl seedKey={path} />
					</div>
				) : timeline.length === 0 ? (
					<div style={{ fontSize: 12 }}>
						No shipped commit touched this file (it may be new and not committed
						yet).
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
											{commitSubject(e.commit.message)}
										</div>
										<div style={{ color: "var(--cabn-text-secondary)" }}>
											{formatCommitDate(e.commit.author.timestamp)} ·{" "}
											{e.commit.author.name} · {shortOid(e.commit.oid)}
										</div>
										<div>
											{e.boundary ? "earliest shipped version" : e.status}
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
							{version?.index === selected ? (
								version.read.kind === "text" ? (
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
										{version.read.text}
									</pre>
								) : (
									<div
										data-testid="pensieve-version-unavailable"
										style={{ fontSize: 12 }}
									>
										{version.read.kind === "binary"
											? "This version is a binary file."
											: NOT_SHIPPED_LABEL[version.read.reason]}
									</div>
								)
							) : view.kind === "loading" ? (
								<div style={{ fontSize: 12 }}>Stirring the memory…</div>
							) : view.kind === "message" ? (
								<div
									data-testid={view.testId}
									style={{
										fontSize: 12,
										padding: 8,
										background: "var(--cabn-inset-tint)",
										borderRadius: 8,
									}}
								>
									{view.text}
								</div>
							) : (
								<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
									<div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
										<DiffView hunks={view.hunks} />
									</div>
								</div>
							)}
							{entry?.blob && (
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
