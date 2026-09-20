import { z } from "zod";

export const AssetsFileSchema = z.object({
	atlases: z.array(z.string()),
});
export type AssetsFile = z.infer<typeof AssetsFileSchema>;
