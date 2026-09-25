import type { ErrorCode, PortalFile, Species } from "@cabn/world-schema";

export interface AnnotateContext {
	file: PortalFile;
	/** Absent for binary or over-cap files — see walk.ts's content cutoff. */
	content?: string;
	/**
	 * Every file path in the world (including this one). Deliberately not the
	 * full WorldManifest (the M1 stub's original field): an annotator only
	 * ever needs "does this path exist anywhere in the world", never
	 * cluster/layout/portal metadata, and a bare path set is what both
	 * convert() (has the whole manifest) and the engine's in-browser re-check
	 * after an edit (only has a portal path list, via the store) can supply
	 * without one having to reconstruct the other.
	 */
	worldFiles: ReadonlySet<string>;
}

export interface ErrorAnnotation {
	code: ErrorCode;
	rule: string;
	message: string;
	/**
	 * 0-based line/col, matching FileScene's line-array indexing and
	 * EditorOverlay's editorInitialLine — not 1-based editor-display line
	 * numbers.
	 */
	loc?: { line: number; col: number };
	species: Species;
	/**
	 * Provisional — run.ts's tiering pass (count of monsters sharing this
	 * annotation's attachment point) overwrites this before a monster ships in
	 * a manifest. Annotators only need to distinguish "cosmetic" (wisp, 0)
	 * from "everything else" (1, bumped to 2 by the tiering pass).
	 */
	tier: number;
}

/**
 * Extension point only for M1 — no implementations shipped until M6. An
 * annotator inspects one file (with the world's file-path set for context)
 * and returns zero or more errors to spawn monsters from.
 *
 * circularImport (OuroborosError/ouroboros) doesn't fit this per-file shape —
 * a cycle spans multiple files and, when it crosses clusters, attaches to a
 * path rather than a portal — so it ships as its own function
 * (circularImport.ts's `findCircularImports`) rather than an `Annotator`;
 * run.ts wires both shapes into one `monsters[]`/`spawns` result.
 */
export type Annotator = (ctx: AnnotateContext) => ErrorAnnotation[];
