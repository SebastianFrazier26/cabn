import type {
	ErrorCode,
	FindingsSummary,
	Monster,
	PortalFile,
	WorldPath,
} from "@cabn/world-schema";
import { shortHash } from "../hash.js";
import { bracketBalance } from "./bracketBalance.js";
import { brokenImport } from "./brokenImport.js";
import {
	type CircularImportResult,
	findCircularImports,
} from "./circularImport.js";
import { codeSmell } from "./codeSmell.js";
import { deadCode } from "./deadCode.js";
import { encodingIssue } from "./encodingIssue.js";
import {
	classifyFinding,
	type ExternalFinding,
	externalFindingMessage,
	externalFindingRule,
	MAX_EXTERNAL_PER_FILE,
	MAX_EXTERNAL_TOTAL,
	resolveFindingPath,
} from "./externalFindings.js";
import { leakedSecret } from "./leakedSecret.js";
import { parseFailure } from "./parseFailure.js";
import { syntaxError } from "./syntaxError.js";
import { BASE_TIER_BY_ERROR_CODE, speciesForErrorCode } from "./taxonomy.js";
import { todoMarker } from "./todoMarker.js";
import type { AnnotateOptions, Annotator, ErrorAnnotation } from "./types.js";

/** Fixed order: also the order same-file monster ids are generated in, which is what makes them stable across runs given unchanged input. New annotators go at the end so existing monsters keep their order. */
export const PER_FILE_ANNOTATORS: readonly Annotator[] = [
	brokenImport,
	parseFailure,
	bracketBalance,
	encodingIssue,
	todoMarker,
	syntaxError,
	leakedSecret,
	deadCode,
	codeSmell,
];

export interface AnnotateWorldOptions {
	annotate?: AnnotateOptions;
	/** Findings from an external tool's results file (see externalFindings.ts). */
	findings?: readonly ExternalFinding[];
	/** Directory the external tool ran in, for resolving its absolute paths. */
	findingsRoot?: string;
}

export interface AnnotateFileInput {
	file: PortalFile;
	/** Absent for binary/oversized files — see walk.ts's content cutoff; such files are skipped entirely (an annotator has nothing to read). */
	content?: string;
}

export interface AnnotateWorldResult {
	monsters: Monster[];
	/** Portal-attached monster ids, grouped by portalId — convert.ts splices these into each portal's own `spawns` field. Path-attached (cross-cluster ouroboros) monsters have no equivalent here; they only exist in `monsters[]`, keyed by `pathId`. */
	spawnsByPortalId: Map<string, string[]>;
	/** Present only when `findings` were passed in. */
	findings?: FindingsSummary;
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
 * the whole-world circularImport pass and any external findings, and turns
 * the combined results into `Monster[]` + per-portal spawn lists.
 *
 * Tiering: each annotation starts at its code's base tier (taxonomy.ts's
 * BASE_TIER_BY_ERROR_CODE: wisp 0, smells/dead code/ordinary bugs 1, syntax
 * errors 2, leaked secrets 3). Everything but wisps and smells is bumped one
 * step (max 3) when its attachment point (portal or path) carries two or
 * more "serious" monsters — anything but wisps, smells and dead code, so a
 * messy-but-working file doesn't inflate its real bugs. For a world with only
 * the original six codes this reproduces the pre-M10 1/2 tiers exactly.
 *
 * Monster ids are a short hash of `code:attachment:rule`, so re-converting
 * unchanged input reproduces the same ids (battle.ts's post-edit re-check
 * relies on this: it recomputes the same rule and compares).
 */
export function annotateWorld(
	files: readonly AnnotateFileInput[],
	fileClusterId: ReadonlyMap<string, string>,
	paths: readonly WorldPath[],
	options: AnnotateWorldOptions = {},
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
			for (const annotation of annotator({
				file,
				content,
				worldFiles,
				options: options.annotate,
			})) {
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

	const findings = options.findings
		? addExternalFindings(
				options.findings,
				worldFiles,
				contentByPath,
				pending,
				options.findingsRoot,
			)
		: undefined;

	const countByAttach = new Map<string, number>();
	for (const p of pending) {
		if (NOT_SERIOUS.has(p.annotation.code)) continue;
		const key = attachKeyOf(p);
		countByAttach.set(key, (countByAttach.get(key) ?? 0) + 1);
	}

	const monsters: Monster[] = [];
	const spawnsByPortalId = new Map<string, string[]>();

	for (const p of pending) {
		const key = attachKeyOf(p);
		const code = p.annotation.code;
		const crowded =
			!NOT_BUMPABLE.has(code) && (countByAttach.get(key) ?? 0) >= 2 ? 1 : 0;
		const tier = Math.min(3, BASE_TIER_BY_ERROR_CODE[code] + crowded);
		const id = `monster:${shortHash(`${code}:${key}:${p.annotation.rule}`, 10)}`;

		const monster: Monster = {
			id,
			...(p.portalId !== undefined ? { portalId: p.portalId } : {}),
			...(p.pathId !== undefined ? { pathId: p.pathId } : {}),
			species: p.annotation.species,
			error: {
				code,
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

	return { monsters, spawnsByPortalId, ...(findings ? { findings } : {}) };
}

const NOT_SERIOUS: ReadonlySet<ErrorCode> = new Set([
	"WispNote",
	"CodeSmell",
	"DeadCode",
]);
const NOT_BUMPABLE: ReadonlySet<ErrorCode> = new Set(["WispNote", "CodeSmell"]);

// A tool's parse error and a built-in gremlin/imp/rot-sprite on the same line
// are the same bug seen twice.
const SYNTAX_FAMILY: ReadonlySet<ErrorCode> = new Set([
	"SyntaxError",
	"IoError",
	"Corrupted",
]);

function sameBug(a: ErrorCode, b: ErrorCode): boolean {
	return a === b || (SYNTAX_FAMILY.has(a) && SYNTAX_FAMILY.has(b));
}

/**
 * Appends external findings to `pending`, after every built-in annotator has
 * run, so a finding that duplicates a built-in annotation (same file, same
 * line, same bug class) is dropped instead of spawning a second monster.
 */
function addExternalFindings(
	findings: readonly ExternalFinding[],
	worldFiles: ReadonlySet<string>,
	contentByPath: ReadonlyMap<string, string>,
	pending: PendingMonster[],
	root: string | undefined,
): FindingsSummary {
	const builtInByPortal = new Map<string, ErrorAnnotation[]>();
	for (const p of pending) {
		if (p.portalId === undefined) continue;
		const list = builtInByPortal.get(p.portalId) ?? [];
		list.push(p.annotation);
		builtInByPortal.set(p.portalId, list);
	}

	const rulesByPortal = new Map<string, Set<string>>();
	let attached = 0;
	for (const finding of findings) {
		if (attached >= MAX_EXTERNAL_TOTAL) break;
		const path = resolveFindingPath(finding.path, worldFiles, root);
		const content = path === undefined ? undefined : contentByPath.get(path);
		if (path === undefined || content === undefined) continue;
		const rules = rulesByPortal.get(path) ?? new Set<string>();
		if (rules.size >= MAX_EXTERNAL_PER_FILE) continue;

		const code = classifyFinding(finding);
		const builtIn = builtInByPortal.get(path) ?? [];
		if (
			builtIn.some((a) => a.loc?.line === finding.line && sameBug(a.code, code))
		)
			continue;

		const baseRule = externalFindingRule(finding, content);
		let rule = baseRule;
		for (let n = 2; rules.has(rule); n++) rule = `${baseRule}#${n}`;
		rules.add(rule);
		rulesByPortal.set(path, rules);

		pending.push({
			portalId: path,
			annotation: {
				code,
				rule,
				message: externalFindingMessage(finding, code),
				loc: { line: finding.line, col: finding.col },
				species: speciesForErrorCode(code),
				tier: BASE_TIER_BY_ERROR_CODE[code],
			},
		});
		attached++;
	}
	return {
		ingested: findings.length,
		attached,
		dropped: findings.length - attached,
	};
}
