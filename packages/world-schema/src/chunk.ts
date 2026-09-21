import { z } from "zod";

export const ChunkFileSchema = z.strictObject({
	content: z.string(),
	encoding: z.literal("utf8"),
});
export type ChunkFile = z.infer<typeof ChunkFileSchema>;

export const WorldChunkSchema = z.strictObject({
	clusterId: z.string(),
	files: z.record(z.string(), ChunkFileSchema),
});
export type WorldChunk = z.infer<typeof WorldChunkSchema>;
