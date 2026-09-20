import { z } from "zod";

export const ChunkFileSchema = z.object({
	content: z.string(),
	encoding: z.literal("utf8"),
});
export type ChunkFile = z.infer<typeof ChunkFileSchema>;

export const WorldChunkSchema = z.object({
	clusterId: z.string(),
	files: z.record(z.string(), ChunkFileSchema),
});
export type WorldChunk = z.infer<typeof WorldChunkSchema>;
