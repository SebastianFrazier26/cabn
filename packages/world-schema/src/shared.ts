import { z } from "zod";

// Species/error codes double as the annotation taxonomy contract: @cabn/converter's
// taxonomy.ts maps these codes to these species, so both live here rather than being
// redefined downstream.
//
// The first six codes/species are the only ones a converter ever writes into
// world.json: every engine ever shipped parses world.json with exactly those
// enums, so one more value there makes an older engine reject the whole
// world. Everything after them ships in monsters.json instead (see
// monsters.ts), which older engines never fetch.
export const WORLD_JSON_ERROR_CODES = [
	"NullTypeError",
	"Corrupted",
	"InvalidMode",
	"IoError",
	"OuroborosError",
	"WispNote",
] as const;

export const EXTENDED_ERROR_CODES = [
	"SyntaxError",
	"LeakedSecret",
	"DeadCode",
	"CodeSmell",
	"UnknownBug",
] as const;

export const ErrorCodeSchema = z.enum([
	...WORLD_JSON_ERROR_CODES,
	...EXTENDED_ERROR_CODES,
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const WORLD_JSON_ERROR_CODE_SET: ReadonlySet<string> = new Set(
	WORLD_JSON_ERROR_CODES,
);

/** True for a code every engine version understands inside world.json. */
export function isWorldJsonErrorCode(code: ErrorCode): boolean {
	return WORLD_JSON_ERROR_CODE_SET.has(code);
}

export const SpeciesSchema = z.enum([
	"ghost",
	"rot-sprite",
	"warded-mimic",
	"gremlin",
	"ouroboros",
	"will-o-wisp",
	"imp",
	"magpie",
	"skeleton",
	"bramble",
	"shade",
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

export const PositionSchema = z.strictObject({
	x: z.number(),
	y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

function tryParseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

export function isHttpsUrl(value: string): boolean {
	return tryParseUrl(value)?.protocol === "https:";
}

/** An https:// URL, nothing else — used for cabn.json's per-preview `url` field. */
export const HttpsUrlSchema = z.string().refine(isHttpsUrl, {
	message: "must be an https:// URL",
});

/**
 * Exact scheme://host[:port] match, no path/query/hash and no wildcards —
 * cabn.json's `allowedEmbedOrigins` entries and everything they're checked
 * against (isAllowedEmbedOrigin below) share this definition of "origin" so
 * converter-time validation and the engine's runtime iframe guard can't drift
 * apart on what counts as allowed.
 */
export function isHttpsOrigin(value: string): boolean {
	const url = tryParseUrl(value);
	if (!url) return false;
	if (url.protocol !== "https:") return false;
	if (url.username || url.password) return false;
	// WHATWG URL parsing accepts "*" as an ordinary hostname code point (it's
	// not on the forbidden-host-code-point list), so "https://*.example.com"
	// parses successfully with origin === value — reject it explicitly rather
	// than relying on the exact-match check above to catch it.
	if (url.hostname.includes("*")) return false;
	return value === url.origin;
}

export const HttpsOriginSchema = z.string().refine(isHttpsOrigin, {
	message:
		"must be an exact https:// origin (scheme://host[:port]) — no path, query, or wildcard",
});

/**
 * Shared by the converter (cabn.json's url-preview-vs-allowlist check at
 * convert time) and the engine's PortalEmbed (a runtime re-check before ever
 * mounting an iframe) — the manifest is untrusted input to the engine same as
 * any other fetched JSON, so PortalEmbed must not just trust that the
 * converter already validated it.
 */
export function isAllowedEmbedOrigin(
	url: string,
	allowedOrigins: readonly string[],
): boolean {
	const parsed = tryParseUrl(url);
	if (parsed?.protocol !== "https:") return false;
	return allowedOrigins.includes(parsed.origin);
}
