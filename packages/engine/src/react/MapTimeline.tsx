import type { CommitChanges, RepoCommit } from "../systems/git/types.js";
import {
	commitSubject,
	formatCommitDate,
	shortOid,
} from "../systems/gitHistory.js";
import type { WorldMapSummary } from "../systems/worldMap.js";

/** The big map's commit slider (react/WorldMap.tsx), a lazy chunk of its own. */
export function MapTimeline({
	commits,
	changes,
	step,
	setStep,
	worldPaths,
}: {
	commits: RepoCommit[];
	changes: CommitChanges | null;
	step: number | null;
	setStep: (step: number | null) => void;
	worldPaths: WorldMapSummary["portals"];
}): React.ReactElement {
	const last = commits.length - 1;
	const commit = step === null ? undefined : commits[last - step];
	const inWorld = new Set(worldPaths.map((p) => p.id));
	return (
		<div
			data-testid="map-timeline"
			style={{ padding: "0 12px 8px", fontSize: 12 }}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<span>Timeline</span>
				<button
					type="button"
					className="cabn-btn neutral"
					aria-label="Older commit"
					onClick={() => setStep(step === null ? last : Math.max(0, step - 1))}
				>
					◀
				</button>
				<input
					type="range"
					aria-label="Commit timeline"
					data-testid="map-timeline-slider"
					min={0}
					max={last}
					value={step ?? last}
					onChange={(e) => setStep(Number(e.target.value))}
					style={{ flex: 1, accentColor: "var(--cabn-accent-violet)" }}
				/>
				<button
					type="button"
					className="cabn-btn neutral"
					aria-label="Newer commit"
					onClick={() =>
						setStep(step === null ? last : Math.min(last, step + 1))
					}
				>
					▶
				</button>
				<button
					type="button"
					className="cabn-btn cancel"
					disabled={step === null}
					onClick={() => setStep(null)}
				>
					Off
				</button>
			</div>
			{commit ? (
				<div data-testid="map-timeline-commit" style={{ marginTop: 4 }}>
					<strong>{commitSubject(commit.message)}</strong> ·{" "}
					{formatCommitDate(commit.author.timestamp)} · {commit.author.name} ·{" "}
					{shortOid(commit.oid)} —{" "}
					{changes === null
						? "reading…"
						: changes.boundary
							? "the oldest shipped commit (nothing earlier to compare with)"
							: `${changes.changes.length} file(s) changed, gold on the map`}
					{changes?.changes.some((c) => !inWorld.has(c.path)) && (
						<span>
							{" "}
							(not in this world:{" "}
							{changes.changes
								.filter((c) => !inWorld.has(c.path))
								.map((c) => `${c.path} ${c.status}`)
								.slice(0, 6)
								.join(", ")}
							)
						</span>
					)}
				</div>
			) : (
				<div style={{ marginTop: 4, color: "var(--cabn-text-secondary)" }}>
					Slide through the last {commits.length} commits to see which files
					each one changed.
				</div>
			)}
		</div>
	);
}
