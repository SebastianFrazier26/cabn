import { iso, z } from "zod";
import { WorldChunkSchema } from "./chunk.js";
import {
	ClusterSchema,
	MonsterSchema,
	PortalSchema,
	type WorldManifest,
	WorldPathSchema,
} from "./manifest.js";
import { SearchIndexFileSchema } from "./search-index.js";
import { SignEntrySchema } from "./signs.js";

/**
 * A world layer is an additive delta over one specific base world: extra
 * clusters, portals, paths, monsters and signs that sit beside the base and
 * never replace or move anything in it. It is never part of a world bundle;
 * a host serves it separately (today only `cabn serve --owner`). The format
 * is deliberately layer-agnostic so the engine can merge one without knowing
 * what it represents.
 */
export const WORLD_LAYER_VERSION = 1;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const WorldLayerStatsSchema = z.strictObject({
	fileCount: z.number().int().nonnegative(),
	totalBytes: z.number().int().nonnegative(),
	truncated: z.boolean(),
	skippedFiles: z.number().int().nonnegative(),
});
export type WorldLayerStats = z.infer<typeof WorldLayerStatsSchema>;

const layerManifestShape = {
	layerVersion: z.literal(WORLD_LAYER_VERSION),
	/** The base world.json's meta.generatedAt this delta was computed against — a mismatch means the delta is stale. */
	baseGeneratedAt: iso.datetime(),
	generatedAt: iso.datetime(),
	stats: WorldLayerStatsSchema,
	clusters: z.array(ClusterSchema),
	paths: z.array(WorldPathSchema),
	portals: z.array(PortalSchema),
	/** Monsters an engine that predates monsters.json can parse (WORLD_JSON_ERROR_CODES). */
	monsters: z.array(MonsterSchema),
	/** The rest, the same split world.json/monsters.json make. */
	extendedMonsters: z.array(MonsterSchema),
	signs: z.array(SignEntrySchema),
	/** Text portal path -> SHA-256 of its bytes on disk, the base hash an edit must name. */
	textSha256: z.record(z.string(), Sha256HexSchema),
};

/** What a host sends first: the layer without file contents or its search index. */
export const WorldLayerManifestSchema = z.strictObject(layerManifestShape);
export type WorldLayerManifest = z.infer<typeof WorldLayerManifestSchema>;

export const WorldLayerDeltaSchema = z.strictObject({
	...layerManifestShape,
	/** Cluster id -> that cluster's chunk. */
	chunks: z.record(z.string(), WorldChunkSchema),
	searchIndex: SearchIndexFileSchema,
});
export type WorldLayerDelta = z.infer<typeof WorldLayerDeltaSchema>;

export class WorldLayerMismatchError extends Error {
	constructor(readonly issues: string[]) {
		super(`world layer does not fit its base world: ${issues.join("; ")}`);
		this.name = "WorldLayerMismatchError";
	}
}

/**
 * Cross-checks a layer against the base world it claims to extend: same
 * generatedAt (a stale layer is refused whole), nothing that collides with
 * or replaces a base id, and no reference that dangles in base ∪ layer.
 * Returns the issues; empty means the layer fits.
 */
export function worldLayerIssues(
	base: Pick<WorldManifest, "meta" | "clusters" | "portals" | "monsters">,
	layer: WorldLayerManifest,
	extraBaseMonsterIds: Iterable<string> = [],
): string[] {
	const issues: string[] = [];
	if (layer.baseGeneratedAt !== base.meta.generatedAt) {
		issues.push("stale: computed for a different base world");
		return issues;
	}
	const baseClusters = new Set(base.clusters.map((c) => c.id));
	const basePortals = new Set(base.portals.map((p) => p.id));
	const baseMonsters = new Set([
		...base.monsters.map((m) => m.id),
		...extraBaseMonsterIds,
	]);

	const layerClusters = new Set<string>();
	for (const c of layer.clusters) {
		if (baseClusters.has(c.id) || layerClusters.has(c.id))
			issues.push(`cluster "${c.id}" collides`);
		layerClusters.add(c.id);
	}
	const allClusters = new Set([...baseClusters, ...layerClusters]);
	const layerPortals = new Set<string>();
	for (const p of layer.portals) {
		if (basePortals.has(p.id) || layerPortals.has(p.id))
			issues.push(`portal "${p.id}" collides`);
		layerPortals.add(p.id);
		if (!layerClusters.has(p.clusterId))
			issues.push(`portal "${p.id}" is not in a layer cluster`);
	}
	for (const c of layer.clusters) {
		for (const id of c.portalIds)
			if (!layerPortals.has(id))
				issues.push(`cluster "${c.id}" names unknown portal "${id}"`);
	}
	const pathIds = new Set<string>();
	for (const path of layer.paths) {
		if (!allClusters.has(path.from) || !allClusters.has(path.to))
			issues.push(`path ${path.from}::${path.to} dangles`);
		if (!layerClusters.has(path.from) && !layerClusters.has(path.to))
			issues.push(`path ${path.from}::${path.to} joins two base clusters`);
		pathIds.add(`${path.from}::${path.to}`);
	}
	const monsterIds = new Set<string>();
	for (const m of [...layer.monsters, ...layer.extendedMonsters]) {
		if (baseMonsters.has(m.id) || monsterIds.has(m.id))
			issues.push(`monster "${m.id}" collides`);
		monsterIds.add(m.id);
		const onPortal = m.portalId !== undefined && layerPortals.has(m.portalId);
		const onPath = m.pathId !== undefined && pathIds.has(m.pathId);
		if (!onPortal && !onPath)
			issues.push(`monster "${m.id}" is not on a layer portal or path`);
	}
	const allPortals = new Set([...basePortals, ...layerPortals]);
	for (const s of layer.signs) {
		const known =
			s.anchor.kind === "portal"
				? allPortals.has(s.anchor.id)
				: allClusters.has(s.anchor.id);
		if (!known) issues.push(`sign "${s.path}" anchors to nothing`);
	}
	for (const path of Object.keys(layer.textSha256))
		if (!layerPortals.has(path))
			issues.push(`hash for "${path}" names no layer portal`);
	const chunks = (layer as Partial<WorldLayerDelta>).chunks;
	for (const [key, chunk] of Object.entries(chunks ?? {})) {
		if (!layerClusters.has(key) || chunk.clusterId !== key)
			issues.push(`chunk "${key}" is not a layer cluster's`);
	}
	return issues;
}

export function assertWorldLayerFits(
	base: Pick<WorldManifest, "meta" | "clusters" | "portals" | "monsters">,
	layer: WorldLayerManifest,
	extraBaseMonsterIds: Iterable<string> = [],
): void {
	const issues = worldLayerIssues(base, layer, extraBaseMonsterIds);
	if (issues.length > 0) throw new WorldLayerMismatchError(issues);
}
