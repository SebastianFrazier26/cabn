import { iso, z } from "zod";
import {
	BiomeSchema,
	ErrorCodeSchema,
	FileKindSchema,
	PathKindSchema,
	PositionSchema,
	SpeciesSchema,
} from "./shared.js";
import { CABN_VERSION } from "./version.js";

export const WorldMetaSchema = z.object({
	name: z.string(),
	source: z.string(),
	generatedAt: iso.datetime(),
	fileCount: z.number().int().nonnegative(),
	totalBytes: z.number().int().nonnegative(),
});
export type WorldMeta = z.infer<typeof WorldMetaSchema>;

export const ClusterSchema = z.object({
	id: z.string(),
	path: z.string(),
	label: z.string(),
	pos: PositionSchema,
	biome: BiomeSchema,
	portalIds: z.array(z.string()),
	chunk: z.string(),
	// Set when a directory with >40 files was split into `<id>__2`, `__3`, ... annexes.
	annexOf: z.string().optional(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const WorldPathSchema = z.object({
	from: z.string(),
	to: z.string(),
	kind: PathKindSchema,
});
export type WorldPath = z.infer<typeof WorldPathSchema>;

export const PortalFileSchema = z.object({
	path: z.string(),
	name: z.string(),
	kind: FileKindSchema,
	language: z.string().optional(),
	bytes: z.number().int().nonnegative(),
	lines: z.number().int().nonnegative().optional(),
	binary: z.boolean(),
});
export type PortalFile = z.infer<typeof PortalFileSchema>;

export const PortalPreviewSchema = z.object({
	lines: z.array(z.string().max(120)).max(12),
	truncated: z.boolean(),
});
export type PortalPreview = z.infer<typeof PortalPreviewSchema>;

export const PortalSchema = z.object({
	id: z.string(),
	clusterId: z.string(),
	file: PortalFileSchema,
	preview: PortalPreviewSchema,
	spawns: z.array(z.string()),
});
export type Portal = z.infer<typeof PortalSchema>;

export const ErrorLocSchema = z.object({
	line: z.number().int().nonnegative(),
	col: z.number().int().nonnegative(),
});
export type ErrorLoc = z.infer<typeof ErrorLocSchema>;

export const MonsterErrorSchema = z.object({
	code: ErrorCodeSchema,
	rule: z.string(),
	message: z.string(),
	loc: ErrorLocSchema.optional(),
});
export type MonsterError = z.infer<typeof MonsterErrorSchema>;

export const MonsterSchema = z.object({
	id: z.string(),
	portalId: z.string().optional(),
	pathId: z.string().optional(),
	species: SpeciesSchema,
	error: MonsterErrorSchema,
	tier: z.number().int().min(0).max(3),
});
export type Monster = z.infer<typeof MonsterSchema>;

export const WorldManifestSchema = z.object({
	cabnVersion: z.literal(CABN_VERSION),
	meta: WorldMetaSchema,
	clusters: z.array(ClusterSchema),
	paths: z.array(WorldPathSchema),
	portals: z.array(PortalSchema),
	// Empty until M6's annotators run, but the shape ships now so downstream
	// consumers (engine, cli inspect) never need a schema migration for it.
	monsters: z.array(MonsterSchema),
});
export type WorldManifest = z.infer<typeof WorldManifestSchema>;
