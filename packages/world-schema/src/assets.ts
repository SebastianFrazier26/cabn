import { z } from "zod";

export const AssetsFileSchema = z.strictObject({
	atlases: z.array(z.string()),
});
export type AssetsFile = z.infer<typeof AssetsFileSchema>;
