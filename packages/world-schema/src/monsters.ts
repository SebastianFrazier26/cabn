import { z } from "zod";
import { type Monster, MonsterSchema, type WorldManifest } from "./manifest.js";

/**
 * Monsters whose error code isn't one of WORLD_JSON_ERROR_CODES (shared.ts)
 * live in a separate `monsters.json` beside world.json, for the same reason
 * media previews live in media.json: world.json is parsed with strict enums
 * by every engine ever shipped, so a new species there would make an older
 * engine reject the whole world. An older engine never requests
 * monsters.json and simply doesn't see these monsters; world.json (and its
 * portals' `spawns`) only ever reference world.json monsters, so nothing in
 * it dangles. CABN_VERSION stays 1. The reader below is tolerant per entry,
 * so the next new code can ship the same way without breaking this engine.
 */
export const MONSTER_INDEX_VERSION = 1;

export const MONSTER_INDEX_FILENAME = "monsters.json";

export const FindingsSummarySchema = z.strictObject({
	/** Findings read from the external results file(s). */
	ingested: z.number().int().nonnegative(),
	/** Findings that became a monster. */
	attached: z.number().int().nonnegative(),
	/** Findings dropped: path not in this world, duplicate of a built-in annotation, or over a cap. */
	dropped: z.number().int().nonnegative(),
});
export type FindingsSummary = z.infer<typeof FindingsSummarySchema>;

export const MonsterIndexFileSchema = z.strictObject({
	monstersVersion: z.literal(MONSTER_INDEX_VERSION),
	monsters: z.array(MonsterSchema),
	findings: FindingsSummarySchema.optional(),
});
export type MonsterIndexFile = z.infer<typeof MonsterIndexFileSchema>;

const LooseMonsterIndexSchema = z.object({
	monstersVersion: z.number(),
	monsters: z.array(z.unknown()),
});

/**
 * Engine-side reader: never throws. A missing/garbled file or a future
 * monstersVersion yields no extra monsters; an entry with a code/species this
 * build doesn't know is dropped on its own.
 */
export function parseMonsterIndex(json: unknown): Monster[] {
	const loose = LooseMonsterIndexSchema.safeParse(json);
	if (!loose.success || loose.data.monstersVersion !== MONSTER_INDEX_VERSION)
		return [];
	const out: Monster[] = [];
	for (const raw of loose.data.monsters) {
		const entry = MonsterSchema.safeParse(raw);
		if (entry.success) out.push(entry.data);
	}
	return out;
}

/**
 * Appends monsters.json entries to a validated manifest's `monsters` (and
 * their portal's `spawns`). monsters.json is untrusted input like world.json,
 * so an entry is dropped when its id collides with one already present or it
 * points at a portal/path the manifest doesn't have — the same dangling-
 * reference guarantees WorldManifestSchema's superRefine gives world.json.
 */
export function mergeMonsterIndex(
	manifest: WorldManifest,
	extra: readonly Monster[],
): WorldManifest {
	if (extra.length === 0) return manifest;
	const ids = new Set(manifest.monsters.map((m) => m.id));
	const portalIds = new Set(manifest.portals.map((p) => p.id));
	const pathIds = new Set(manifest.paths.map((p) => `${p.from}::${p.to}`));
	const spawnsByPortal = new Map<string, string[]>();
	const added: Monster[] = [];

	for (const monster of extra) {
		if (ids.has(monster.id)) continue;
		const onPortal =
			monster.portalId !== undefined && portalIds.has(monster.portalId);
		const onPath = monster.pathId !== undefined && pathIds.has(monster.pathId);
		if (!onPortal && !onPath) continue;
		ids.add(monster.id);
		added.push(monster);
		if (onPortal && monster.portalId !== undefined) {
			const list = spawnsByPortal.get(monster.portalId) ?? [];
			list.push(monster.id);
			spawnsByPortal.set(monster.portalId, list);
		}
	}
	if (added.length === 0) return manifest;

	return {
		...manifest,
		portals: manifest.portals.map((portal) => {
			const more = spawnsByPortal.get(portal.id);
			return more ? { ...portal, spawns: [...portal.spawns, ...more] } : portal;
		}),
		monsters: [...manifest.monsters, ...added],
	};
}
