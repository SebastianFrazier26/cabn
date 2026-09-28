import type { ErrorCode, Species } from "@cabn/world-schema";

// One species per error code, seeded from the original Rust prototype's
// PhileErr enum (rust-prototype branch, src/phile.rs: IoError, InvalidMode,
// Corrupted, NullTypeError) plus two cabn-native codes (OuroborosError,
// WispNote), then five M10 codes that ship in monsters.json rather than
// world.json (see @cabn/world-schema's monsters.ts). Each code maps to exactly one species — the pairing is the
// taxonomy, not an implementation detail annotators get to override.
export const SPECIES_BY_ERROR_CODE: Record<ErrorCode, Species> = {
	NullTypeError: "ghost",
	Corrupted: "rot-sprite",
	InvalidMode: "warded-mimic",
	IoError: "gremlin",
	OuroborosError: "ouroboros",
	WispNote: "will-o-wisp",
	SyntaxError: "imp",
	LeakedSecret: "magpie",
	DeadCode: "skeleton",
	CodeSmell: "bramble",
	UnknownBug: "shade",
};

/** Base tier per code before run.ts's crowding bump: cosmetic < smell/dead code/ordinary < a real syntax error < a leaked credential. */
export const BASE_TIER_BY_ERROR_CODE: Record<ErrorCode, number> = {
	NullTypeError: 1,
	Corrupted: 1,
	InvalidMode: 1,
	IoError: 1,
	OuroborosError: 1,
	WispNote: 0,
	SyntaxError: 2,
	LeakedSecret: 3,
	DeadCode: 1,
	CodeSmell: 1,
	UnknownBug: 1,
};

export function speciesForErrorCode(code: ErrorCode): Species {
	return SPECIES_BY_ERROR_CODE[code];
}
