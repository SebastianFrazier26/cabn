export const CABN_VERSION = 1;

// Type stubs only for M0 — runtime validation (zod) lands in M1.
export type WorldNodeKind = "portal" | "cluster" | "monster";

export interface WorldNode {
	kind: WorldNodeKind;
	name: string;
	children?: WorldNode[];
}

export interface World {
	version: number;
	root: WorldNode;
}
