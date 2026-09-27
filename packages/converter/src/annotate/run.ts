import type { Monster, PortalFile, WorldPath } from "@cabn/world-schema";
import { shortHash } from "../hash.js";
import { bracketBalance } from "./bracketBalance.js";
import { brokenImport } from "./brokenImport.js";
import {
	type CircularImportResult,
	findCircularImports,
} from "./circularImport.js";
import { encodingIssue } from "./encodingIssue.js";
import { parseFailure } from "./parseFailure.js";
import { todoMarker } from "./todoMarker.js";
import type { Annotator, ErrorAnnotation } from "./types.js";

/** Fixed order: also the order same-file monster ids are generated in, which is what makes them stable across runs given unchanged input. */
export const PER_FILE_ANNOTATORS: readonly Annotator[] = [
	brokenImport,
	parseFailure,
	bracketBalance,
	encodingIssue,
	todoMarker,
];

export interface AnnotateFileInput {
	file: PortalFile;
	/** Absent for binary/oversized files — see walk.ts's content cutoff; such files are skipped entirely (an annotator has nothing to read). */
	content?: string;
}

export interface AnnotateWorldResult {
	monsters: Monster[];
	/** Portal-attached monster ids, grouped by portalId — convert.ts splices these into each portal's own `spawns` field. Path-attached (cross-cluster ouroboros) monsters have no equivalent here; they only exist in `monsters[]`, keyed by `pathId`. */
	spawnsByPortalId: Map<string, string[]>;
}

interface PendingMonster {
	portalId?: string;
	pathId?: string;
	annotation: ErrorAnnotation;
}

type CycleAttachment =
	| { kind: "portal"; portalId: string }
	| { kind: "path"; pathId: string };

/**
 * A cycle wholly inside one cluster attaches to its first (lexicographically
 * smallest) member file. A cycle crossing clusters attaches to an existing
 * WorldPath connecting the first member's cluster to another member's
 * cluster, if one exists — `pathId` is that path's own `${from}::${to}` (no
 * `id` field on WorldPath itself; this composite key is the convention both
 * convert.ts and the engine use to look a path back up). A cycle spanning
 * clusters with no direct path between any two of its members (3+ clusters,
 * non-adjacent in the radial layout) falls back to the first-file portal
 * attachment rather than going unattached.
 */
function attachCycle(
	cycle: CircularImportResult,
	fileClusterId: ReadonlyMap<string, string>,
	paths: readonly WorldPath[],
): CycleAttachment {
	const first = cycle.members[0] ?? "";
	const firstCluster = fileClusterId.get(first);
	const otherMember = firstCluster
		? cycle.members.find((m) => fileClusterId.get(m) !== firstCluster)
		: undefined;

	if (!firstCluster || !otherMember) return { kind: "portal", portalId: first };

	const otherCluster = fileClusterId.get(otherMember);
	const match = paths.find(
		(p) =>
			(p.from === firstCluster && p.to === otherCluster) ||
			(p.from === otherCluster && p.to === firstCluster),
	);
	return match
		? { kind: "path", pathId: `${match.from}::${match.to}` }
		: { kind: "portal", portalId: first };
}

function attachKeyOf(pending: PendingMonster): string {
	return pending.portalId ?? `path:${pending.pathId}`;
}

/**
 * Runs every per-file annotator over every file with readable content, plus
 * the whole-world circularImport pass, and turns the combined results into
 * `Monster[]` + per-portal spawn lists. Tiering is purely count-based and
 * documented here rather than split across annotators: WispNote is always
 * tier 0 (cosmetic, see todoMarker.ts); everything else is tier 1, bumped to
 * tier 2 when its attachment point (portal or path) already has another
 * non-wisp monster on it — a rough "this place is a mess" signal, not a
 * per-species severity ranking. Monster ids are a short hash of
 * `code:attachment:rule`, so re-converting unchanged input reproduces the
 * same ids (battle.ts's post-edit re-check relies on this: it recomputes the
 * same rule and compares).
 */
export function annotateWorld(
	files: readonly AnnotateFileInput[],
	fileClusterId: ReadonlyMap<string, string>,
	paths: readonly WorldPath[],
): AnnotateWorldResult {
	const worldFiles = new Set(files.map((f) => f.file.path));
	const contentByPath = new Map<string, string>();
	for (const f of files) {
		if (f.content !== undefined) contentByPath.set(f.file.path, f.content);
	}

	const pending: PendingMonster[] = [];

	for (const { file, content } of files) {
		if (content === undefined) continue;
		for (const annotator of PER_FILE_ANNOTATORS) {
			for (const annotation of annotator({ file, content, worldFiles })) {
				pending.push({ portalId: file.path, annotation });
			}
		}
	}

	for (const cycle of findCircularImports(contentByPath)) {
		const attachment = attachCycle(cycle, fileClusterId, paths);
		pending.push({
			portalId: attachment.kind === "portal" ? attachment.portalId : undefined,
			pathId: attachment.kind === "path" ? attachment.pathId : undefined,
			annotation: {
				code: "OuroborosError",
				rule: cycle.rule,
				message: cycle.message,
				loc:
					attachment.kind === "portal" && cycle.entryLoc
						? { line: cycle.entryLoc.line, col: cycle.entryLoc.col }
						: undefined,
				species: "ouroboros",
				tier: 1,
			},
		});
	}

	const countByAttach = new Map<string, number>();
	for (const p of pending) {
		if (p.annotation.code === "WispNote") continue;
		const key = attachKeyOf(p);
		countByAttach.set(key, (countByAttach.get(key) ?? 0) + 1);
	}

	const monsters: Monster[] = [];
	const spawnsByPortalId = new Map<string, string[]>();

	for (const p of pending) {
		const key = attachKeyOf(p);
		const tier =
			p.annotation.code === "WispNote"
				? 0
				: (countByAttach.get(key) ?? 1) >= 2
					? 2
					: 1;
		const id = `monster:${shortHash(`${p.annotation.code}:${key}:${p.annotation.rule}`, 10)}`;

		const monster: Monster = {
			id,
			...(p.portalId !== undefined ? { portalId: p.portalId } : {}),
			...(p.pathId !== undefined ? { pathId: p.pathId } : {}),
			species: p.annotation.species,
			error: {
				code: p.annotation.code,
				rule: p.annotation.rule,
				message: p.annotation.message,
				...(p.annotation.loc ? { loc: p.annotation.loc } : {}),
			},
			tier,
		};
		monsters.push(monster);

		if (p.portalId !== undefined) {
			const list = spawnsByPortalId.get(p.portalId) ?? [];
			list.push(id);
			spawnsByPortalId.set(p.portalId, list);
		}
	}

	return { monsters, spawnsByPortalId };
}
