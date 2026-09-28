import { reverseApplyHunks } from "@cabn/converter/browser";
import {
	HISTORY_DIFF_FILE_PATTERN,
	type HistoryBranch,
	type HistoryChange,
	type HistoryCommit,
	type HistoryHunk,
	type HistoryIndexFile,
	UNIVERSE_WORLD_URL_PATTERN,
} from "@cabn/world-schema";

/** Pure reads over history.json for the rift, the map timeline and the pensieve. */

export function findBranch(
	history: HistoryIndexFile,
	name: string,
): HistoryBranch | undefined {
	return history.branches.find((b) => b.name === name);
}

export function currentBranchName(history: HistoryIndexFile): string {
	return (
		history.branches.find((b) => b.current)?.name ??
		history.head.branch ??
		"HEAD"
	);
}

export function commitsByOid(
	history: HistoryIndexFile,
): Map<string, HistoryCommit> {
	return new Map(history.commits.map((c) => [c.oid, c]));
}

/** A branch's commits, newest first, as far as history.json carries them. */
export function branchCommits(
	history: HistoryIndexFile,
	branchName: string,
): HistoryCommit[] {
	const branch = findBranch(history, branchName);
	if (!branch) return [];
	const byOid = commitsByOid(history);
	return branch.commits.flatMap((oid) => {
		const commit = byOid.get(oid);
		return commit ? [commit] : [];
	});
}

export interface FileTimelineEntry {
	commit: HistoryCommit;
	change: HistoryChange;
}

/** Every commit on the branch that touched `path`, newest first. */
export function fileTimeline(
	history: HistoryIndexFile,
	branchName: string,
	path: string,
): FileTimelineEntry[] {
	return branchCommits(history, branchName).flatMap((commit) => {
		const change = commit.changes.find((c) => c.path === path);
		return change ? [{ commit, change }] : [];
	});
}

export function changedPaths(commit: HistoryCommit | undefined): Set<string> {
	return new Set(commit?.changes.map((c) => c.path) ?? []);
}

export function shortOid(oid: string): string {
	return oid.slice(0, 7);
}

export function commitSubject(commit: HistoryCommit): string {
	return commit.message.split("\n", 1)[0] ?? "";
}

export function formatCommitDate(time: number): string {
	return new Date(time * 1000).toISOString().slice(0, 10);
}

/**
 * Resolves a bundle-relative path from history.json against its base, but
 * only when it has the exact shape the converter writes — the schema
 * already enforces this, and the fetch site checks again so no future
 * caller can hand it an arbitrary string.
 */
export function bundleUrl(
	base: string,
	relative: string,
	kind: "diff" | "universe",
): string | null {
	const pattern =
		kind === "diff" ? HISTORY_DIFF_FILE_PATTERN : UNIVERSE_WORLD_URL_PATTERN;
	return pattern.test(relative) ? `${base}${relative}` : null;
}

/** Deterministic per-universe hue from its slug; the main world (null) gets none. */
export function universeTint(slug: string | null): number | null {
	if (slug === null) return null;
	let hash = 0x811c9dc5;
	for (let i = 0; i < slug.length; i++) {
		hash ^= slug.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	const hue = (hash >>> 0) % 360;
	return hslToRgb(hue / 360, 0.65, 0.55);
}

function hslToRgb(h: number, s: number, l: number): number {
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const channel = (t: number) => {
		let x = t;
		if (x < 0) x += 1;
		if (x > 1) x -= 1;
		if (x < 1 / 6) return p + (q - p) * 6 * x;
		if (x < 1 / 2) return q;
		if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
		return p;
	};
	const r = Math.round(channel(h + 1 / 3) * 255);
	const g = Math.round(channel(h) * 255);
	const b = Math.round(channel(h - 1 / 3) * 255);
	return (r << 16) | (g << 8) | b;
}

export function cssColor(rgb: number): string {
	return `#${rgb.toString(16).padStart(6, "0")}`;
}

/**
 * Rebuilds the file as it stood after `steps.length` newer changes are
 * undone: `current` is the newest version, `steps` the newer-first hunks to
 * reverse. Null when any step is missing (withheld/omitted diff) or doesn't
 * apply — the pensieve then says the version can't be rebuilt rather than
 * showing something wrong.
 */
export function rebuildVersion(
	current: string,
	steps: readonly (readonly HistoryHunk[] | null)[],
): string | null {
	let text = current;
	for (const hunks of steps) {
		if (!hunks) return null;
		const previous = reverseApplyHunks(text, hunks);
		if (previous === null) return null;
		text = previous;
	}
	return text;
}

export const DIFF_STATE_LABEL: Record<HistoryChange["diff"], string> = {
	included: "",
	"sealed-secret": "Withheld: this version may contain a secret.",
	"sealed-path": "Sealed: secret files are never shown from any commit.",
	binary: "A binary file changed.",
	"too-large": "This change is too large to show.",
	omitted: "Left out to keep the world small.",
};
