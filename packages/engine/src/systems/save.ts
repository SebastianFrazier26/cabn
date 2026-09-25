import type { Position } from "@cabn/world-schema";
import { PositionSchema } from "@cabn/world-schema";
import { iso, z } from "zod";
import type { BagSlot } from "./bag.js";

/**
 * fnv1a, same algorithm as `@cabn/converter`'s hash.ts (themeSeed, cluster-id
 * collision suffixes) but reimplemented here rather than imported: it's five
 * lines with no state, and pulling in a converter-internal (not part of its
 * `./browser` barrel) for one hash function isn't worth the cross-package
 * coupling.
 */
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * A world's save slot is keyed by its content identity (source + the moment
 * it was converted), not its name or url — two worlds converted from the
 * same source at different times are different saves (the source may have
 * changed), but the same converted bundle served from a different url (e.g.
 * a different demo host) resumes the same save.
 */
export function computeWorldId(meta: {
	source: string;
	generatedAt: string;
}): string {
	return fnv1a(`${meta.source}\u0000${meta.generatedAt}`)
		.toString(16)
		.padStart(8, "0");
}

export const SAVE_SCHEMA_VERSION = 1;

const FileOverrideSchema = z.strictObject({
	content: z.string(),
	savedAt: iso.datetime(),
});
export type FileOverride = z.infer<typeof FileOverrideSchema>;

const BagSlotSchema = z.strictObject({
	id: z.string(),
	text: z.string(),
	sourcePortalId: z.string(),
	startLine: z.number().int().nonnegative(),
	endLine: z.number().int().nonnegative(),
}) satisfies z.ZodType<BagSlot>;

// Keyed loosely by "wherever a player position matters" (currently "world"
// for WorldScene's spawn/return point, and `file:<portalId>` per opened file's
// scroll position) rather than a closed enum — new scenes can start saving
// their own position under a new key without a schema migration.
const SaveDataShapeSchema = z.strictObject({
	version: z.literal(SAVE_SCHEMA_VERSION),
	worldId: z.string(),
	fileOverrides: z.record(z.string(), FileOverrideSchema),
	playerPositions: z.record(z.string(), PositionSchema),
	visitedClusters: z.array(z.string()),
	bagSlots: z.array(BagSlotSchema),
});
export type SaveData = z.infer<typeof SaveDataShapeSchema>;

export function emptySaveData(worldId: string): SaveData {
	return {
		version: SAVE_SCHEMA_VERSION,
		worldId,
		fileOverrides: {},
		playerPositions: {},
		visitedClusters: [],
		bagSlots: [],
	};
}

/**
 * `version: z.literal(SAVE_SCHEMA_VERSION)` doubles as the version gate — a
 * save written by an older or newer schema version fails this parse (wrong
 * literal) exactly the same way a structurally corrupt save does, so both
 * collapse into the same "ignore it" path rather than needing a separate
 * migration branch that doesn't exist yet.
 */
export function parseSaveData(json: unknown): SaveData | null {
	const result = SaveDataShapeSchema.safeParse(json);
	if (!result.success) {
		console.warn(
			"cabn: ignoring unreadable save data",
			z.prettifyError(result.error),
		);
		return null;
	}
	return result.data;
}

// --- Pure reducer ops -------------------------------------------------
// Each takes a SaveData and returns a new one; callers (WorldScene/FileScene)
// own deciding *when* to call these and persisting the result.

export function withFileOverride(
	save: SaveData,
	portalId: string,
	content: string,
	savedAt: string,
): SaveData {
	return {
		...save,
		fileOverrides: {
			...save.fileOverrides,
			[portalId]: { content, savedAt },
		},
	};
}

export function withoutFileOverride(
	save: SaveData,
	portalId: string,
): SaveData {
	if (!(portalId in save.fileOverrides)) return save;
	const fileOverrides = { ...save.fileOverrides };
	delete fileOverrides[portalId];
	return { ...save, fileOverrides };
}

export function withPlayerPosition(
	save: SaveData,
	sceneKey: string,
	pos: Position,
): SaveData {
	return {
		...save,
		playerPositions: { ...save.playerPositions, [sceneKey]: pos },
	};
}

export function withVisitedCluster(
	save: SaveData,
	clusterId: string,
): SaveData {
	if (save.visitedClusters.includes(clusterId)) return save;
	return { ...save, visitedClusters: [...save.visitedClusters, clusterId] };
}

export function withBagSlots(
	save: SaveData,
	bagSlots: readonly BagSlot[],
): SaveData {
	return { ...save, bagSlots: [...bagSlots] };
}

// --- Override application (pure — the "edited content wins" rule) -----

/**
 * A cluster chunk's raw `path -> content` map, with any saved overrides for
 * portals in that cluster spliced in. `chunkContents` itself stays pristine
 * (WorldScene's own cache is never mutated) so "reset this file" always has
 * the original to fall back to — this function is called at the read sites
 * (enter-portal, preview) instead.
 */
export function applyOverridesToChunk(
	files: Readonly<Record<string, string>>,
	portalPathById: ReadonlyMap<string, string>,
	fileOverrides: Readonly<Record<string, FileOverride>>,
): Record<string, string> {
	const result = { ...files };
	for (const [portalId, override] of Object.entries(fileOverrides)) {
		const path = portalPathById.get(portalId);
		if (path !== undefined && path in result) result[path] = override.content;
	}
	return result;
}

/** Same "override wins" rule for a single portal's arch preview lines. */
export function previewSourceLines(
	portalId: string,
	fallbackLines: readonly string[],
	fileOverrides: Readonly<Record<string, FileOverride>>,
): readonly string[] {
	const override = fileOverrides[portalId];
	return override ? override.content.split("\n") : fallbackLines;
}

// --- localStorage adapter ----------------------------------------------
// Thin and defensive on purpose: private-browsing/storage-quota errors and a
// missing `localStorage` global (SSR, non-browser test runners) both just
// fall back to an empty save rather than throwing.

const SAVE_KEY_PREFIX = "cabn:save:";

export function saveKeyFor(worldId: string): string {
	return `${SAVE_KEY_PREFIX}${worldId}`;
}

function hasLocalStorage(): boolean {
	return typeof localStorage !== "undefined";
}

export function loadSave(worldId: string): SaveData {
	if (!hasLocalStorage()) return emptySaveData(worldId);
	try {
		const raw = localStorage.getItem(saveKeyFor(worldId));
		if (raw === null) return emptySaveData(worldId);
		return parseSaveData(JSON.parse(raw)) ?? emptySaveData(worldId);
	} catch (err) {
		console.warn("cabn: failed to read save data", err);
		return emptySaveData(worldId);
	}
}

export function persistSave(save: SaveData): void {
	if (!hasLocalStorage()) return;
	try {
		localStorage.setItem(saveKeyFor(save.worldId), JSON.stringify(save));
	} catch (err) {
		console.warn("cabn: failed to persist save data", err);
	}
}

export function clearSave(worldId: string): void {
	if (!hasLocalStorage()) return;
	try {
		localStorage.removeItem(saveKeyFor(worldId));
	} catch (err) {
		console.warn("cabn: failed to clear save data", err);
	}
}
