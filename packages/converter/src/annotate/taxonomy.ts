import type { ErrorCode, Species } from "@cabn/world-schema";

// One species per error code, seeded from the original Rust prototype's
// PhileErr enum (rust-prototype branch, src/phile.rs: IoError, InvalidMode,
// Corrupted, NullTypeError) plus two cabn-native codes (OuroborosError,
// WispNote). Each code maps to exactly one species — the pairing is the
// taxonomy, not an implementation detail annotators get to override.
export const SPECIES_BY_ERROR_CODE: Record<ErrorCode, Species> = {
	NullTypeError: "ghost",
	Corrupted: "rot-sprite",
	InvalidMode: "warded-mimic",
	IoError: "gremlin",
	OuroborosError: "ouroboros",
	WispNote: "will-o-wisp",
};

export function speciesForErrorCode(code: ErrorCode): Species {
	return SPECIES_BY_ERROR_CODE[code];
}
