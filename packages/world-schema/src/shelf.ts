import { iso, z } from "zod";
import {
	WORLD_DESCRIPTION_MAX_CHARS,
	WORLD_LINKS_MAX,
	WorldLinkSchema,
} from "./cabnConfig.js";
import { HttpsUrlSchema } from "./shared.js";
import { CABN_VERSION } from "./version.js";

export const ShelfMetaSchema = z.strictObject({
	name: z.string(),
	generatedAt: iso.datetime(),
});
export type ShelfMeta = z.infer<typeof ShelfMetaSchema>;

export const ShelfWorldEntrySchema = z.strictObject({
	id: z.string(),
	name: z.string(),
	worldUrl: z.string(),
	themeSeed: z.number().int(),
	fileCount: z.number().int().nonnegative(),
	totalBytes: z.number().int().nonnegative(),
	// The four below come from the world's showcase.json and are written only
	// when set, so a shelf of worlds without one still validates against
	// engines from before these fields (same contract as world.json's `guide`).
	description: z.string().max(WORLD_DESCRIPTION_MAX_CHARS).optional(),
	links: z.array(WorldLinkSchema).max(WORLD_LINKS_MAX).optional(),
	/** The world's hero site url, for a host that wants to link it straight from the shelf. */
	heroUrl: HttpsUrlSchema.optional(),
	order: z.number().int().optional(),
});
export type ShelfWorldEntry = z.infer<typeof ShelfWorldEntrySchema>;

const ShelfManifestShapeSchema = z.strictObject({
	cabnVersion: z.literal(CABN_VERSION),
	meta: ShelfMetaSchema,
	worlds: z.array(ShelfWorldEntrySchema),
});

// Same rationale as WorldManifestSchema's superRefine: each entry is
// individually valid on its own, only a duplicate id across entries breaks
// the shelf (the engine keys cabins and boot targets off world.id).
export const ShelfManifestSchema = ShelfManifestShapeSchema.superRefine(
	(shelf, ctx) => {
		const ids = new Set<string>();
		for (const [index, world] of shelf.worlds.entries()) {
			if (ids.has(world.id)) {
				ctx.addIssue({
					code: "custom",
					message: `duplicate world id "${world.id}"`,
					path: ["worlds", index, "id"],
				});
			}
			ids.add(world.id);
		}
	},
);
export type ShelfManifest = z.infer<typeof ShelfManifestSchema>;
