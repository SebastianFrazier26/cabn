import { z } from "zod";

// Species/error codes double as the annotation taxonomy contract: @cabn/converter's
// taxonomy.ts maps these codes to these species, so both live here rather than being
// redefined downstream.
export const ErrorCodeSchema = z.enum([
	"NullTypeError",
	"Corrupted",
	"InvalidMode",
	"IoError",
	"OuroborosError",
	"WispNote",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const SpeciesSchema = z.enum([
	"ghost",
	"rot-sprite",
	"warded-mimic",
	"gremlin",
	"ouroboros",
	"will-o-wisp",
]);
export type Species = z.infer<typeof SpeciesSchema>;

export const FileKindSchema = z.enum([
	"code",
	"markdown",
	"config",
	"data",
	"image",
	"binary",
	"unknown",
]);
export type FileKind = z.infer<typeof FileKindSchema>;

export const BiomeSchema = z.enum(["meadow", "grove", "glade"]);
export type Biome = z.infer<typeof BiomeSchema>;

export const PathKindSchema = z.enum(["trail", "vine"]);
export type PathKind = z.infer<typeof PathKindSchema>;

export const PositionSchema = z.object({
	x: z.number(),
	y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;
