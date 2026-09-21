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

export const WorldMetaSchema = z.strictObject({
	name: z.string(),
	source: z.string(),
	generatedAt: iso.datetime(),
	fileCount: z.number().int().nonnegative(),
	totalBytes: z.number().int().nonnegative(),
	/** True if the source had more files than the converter's caps allowed — a partial world. */
	truncated: z.boolean(),
	/** Files dropped entirely because of truncated (not counted for content-omitted files, which still get a portal). */
	skippedFiles: z.number().int().nonnegative(),
	/**
	 * fnv1a(meta.source) — the converter fills this in, not hand-authored.
	 * Optional so a hand-built or pre-shelf-hierarchy manifest still validates;
	 * consumers that tint by theme (engine's systems/theme.ts) fall back to a
	 * fixed seed when it's absent.
	 */
	themeSeed: z.number().int().optional(),
});
export type WorldMeta = z.infer<typeof WorldMetaSchema>;

export const ClusterSchema = z.strictObject({
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

export const WorldPathSchema = z.strictObject({
	from: z.string(),
	to: z.string(),
	kind: PathKindSchema,
});
export type WorldPath = z.infer<typeof WorldPathSchema>;

export const PortalFileSchema = z.strictObject({
	path: z.string(),
	name: z.string(),
	kind: FileKindSchema,
	language: z.string().optional(),
	bytes: z.number().int().nonnegative(),
	lines: z.number().int().nonnegative().optional(),
	binary: z.boolean(),
});
export type PortalFile = z.infer<typeof PortalFileSchema>;

export const PortalPreviewSchema = z.strictObject({
	lines: z.array(z.string().max(120)).max(12),
	truncated: z.boolean(),
});
export type PortalPreview = z.infer<typeof PortalPreviewSchema>;

export const PortalSchema = z.strictObject({
	id: z.string(),
	clusterId: z.string(),
	file: PortalFileSchema,
	preview: PortalPreviewSchema,
	spawns: z.array(z.string()),
});
export type Portal = z.infer<typeof PortalSchema>;

export const ErrorLocSchema = z.strictObject({
	line: z.number().int().nonnegative(),
	col: z.number().int().nonnegative(),
});
export type ErrorLoc = z.infer<typeof ErrorLocSchema>;

export const MonsterErrorSchema = z.strictObject({
	code: ErrorCodeSchema,
	rule: z.string(),
	message: z.string(),
	loc: ErrorLocSchema.optional(),
});
export type MonsterError = z.infer<typeof MonsterErrorSchema>;

export const MonsterSchema = z.strictObject({
	id: z.string(),
	portalId: z.string().optional(),
	pathId: z.string().optional(),
	species: SpeciesSchema,
	error: MonsterErrorSchema,
	tier: z.number().int().min(0).max(3),
});
export type Monster = z.infer<typeof MonsterSchema>;

const WorldManifestShapeSchema = z.strictObject({
	cabnVersion: z.literal(CABN_VERSION),
	meta: WorldMetaSchema,
	clusters: z.array(ClusterSchema),
	paths: z.array(WorldPathSchema),
	portals: z.array(PortalSchema),
	// Empty until M6's annotators run, but the shape ships now so downstream
	// consumers (engine, cli inspect) never need a schema migration for it.
	monsters: z.array(MonsterSchema),
});

// Cross-reference checks catch a corrupted/hand-edited world (dangling
// references, id collisions) that per-field schemas can't see on their own —
// each field is individually valid, only the combination is broken.
export const WorldManifestSchema = WorldManifestShapeSchema.superRefine(
	(manifest, ctx) => {
		const clusterIds = new Set<string>();
		for (const [index, cluster] of manifest.clusters.entries()) {
			if (clusterIds.has(cluster.id)) {
				ctx.addIssue({
					code: "custom",
					message: `duplicate cluster id "${cluster.id}"`,
					path: ["clusters", index, "id"],
				});
			}
			clusterIds.add(cluster.id);
		}

		const portalIds = new Set<string>();
		for (const [index, portal] of manifest.portals.entries()) {
			if (portalIds.has(portal.id)) {
				ctx.addIssue({
					code: "custom",
					message: `duplicate portal id "${portal.id}"`,
					path: ["portals", index, "id"],
				});
			}
			portalIds.add(portal.id);
			if (!clusterIds.has(portal.clusterId)) {
				ctx.addIssue({
					code: "custom",
					message: `portal "${portal.id}" references unknown clusterId "${portal.clusterId}"`,
					path: ["portals", index, "clusterId"],
				});
			}
		}

		for (const [index, path] of manifest.paths.entries()) {
			if (!clusterIds.has(path.from)) {
				ctx.addIssue({
					code: "custom",
					message: `path references unknown cluster "${path.from}"`,
					path: ["paths", index, "from"],
				});
			}
			if (!clusterIds.has(path.to)) {
				ctx.addIssue({
					code: "custom",
					message: `path references unknown cluster "${path.to}"`,
					path: ["paths", index, "to"],
				});
			}
		}

		for (const [index, cluster] of manifest.clusters.entries()) {
			for (const [portalIndex, portalId] of cluster.portalIds.entries()) {
				if (!portalIds.has(portalId)) {
					ctx.addIssue({
						code: "custom",
						message: `cluster "${cluster.id}" references unknown portal "${portalId}"`,
						path: ["clusters", index, "portalIds", portalIndex],
					});
				}
			}
		}
	},
);
export type WorldManifest = z.infer<typeof WorldManifestSchema>;
