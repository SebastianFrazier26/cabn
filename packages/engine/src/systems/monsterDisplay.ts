import type { Species } from "@cabn/world-schema";

/** Player-facing species names for the encounter banner and HUD — the taxonomy's own slugs (@cabn/converter's taxonomy.ts) are identifiers, not display text. */
const SPECIES_DISPLAY_NAME: Record<Species, string> = {
	ghost: "Ghost",
	"rot-sprite": "Rot-sprite",
	"warded-mimic": "Warded Mimic",
	gremlin: "Gremlin",
	ouroboros: "Ouroboros",
	"will-o-wisp": "Will-o'-Wisp",
};

export function speciesDisplayName(species: Species): string {
	return SPECIES_DISPLAY_NAME[species];
}
