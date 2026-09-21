import type {
	ErrorCode,
	PortalFile,
	Species,
	WorldManifest,
} from "@cabn/world-schema";

export interface AnnotateContext {
	file: PortalFile;
	/** Absent for binary or over-cap files — see walk.ts's content cutoff. */
	content?: string;
	world: WorldManifest;
}

export interface ErrorAnnotation {
	code: ErrorCode;
	rule: string;
	message: string;
	loc?: { line: number; col: number };
	species: Species;
	tier: number;
}

/**
 * Extension point only for M1 — no implementations ship until M6. An
 * annotator inspects one file (with the world built so far for context) and
 * returns zero or more errors to spawn monsters from.
 */
export type Annotator = (ctx: AnnotateContext) => ErrorAnnotation[];
