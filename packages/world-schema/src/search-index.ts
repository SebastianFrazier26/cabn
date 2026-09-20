import { z } from "zod";

export const SearchIndexFileSchema = z.object({
	engine: z.literal("minisearch"),
	version: z.string(),
	// MiniSearch.toJSON() output; shape is opaque here since it's a serialized
	// engine payload the converter round-trips through MiniSearch.loadJSON, not
	// something this package ever inspects.
	index: z.unknown(),
});
export type SearchIndexFile = z.infer<typeof SearchIndexFileSchema>;
