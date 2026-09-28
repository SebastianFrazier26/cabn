import { timingSafeEqual } from "node:crypto";
import { sha256Hex } from "./config.js";

const BEARER_PREFIX = "Bearer ";

/** Undefined for anything that isn't exactly `Bearer <nonempty token>` — a missing header, wrong scheme, or empty token all collapse to the same "no token" result so the caller can give one generic 401. */
export function extractBearerToken(
	header: string | undefined,
): string | undefined {
	if (!header?.startsWith(BEARER_PREFIX)) return undefined;
	const token = header.slice(BEARER_PREFIX.length).trim();
	return token.length > 0 ? token : undefined;
}

/**
 * Every stored hash is checked, never short-circuited on the first match —
 * otherwise the number of timingSafeEqual calls (and thus response time)
 * would leak which position in CABN_API_KEY_SHA256 a valid key sits at.
 * SHA-256 digests are always 32 bytes, so timingSafeEqual's equal-length
 * requirement holds regardless of which stored hash is being compared.
 */
export function verifyApiKey(
	presentedToken: string,
	hashes: readonly Buffer[],
): boolean {
	const presentedHash = Buffer.from(sha256Hex(presentedToken), "hex");
	let matched = false;
	for (const hash of hashes) {
		if (timingSafeEqual(presentedHash, hash)) matched = true;
	}
	return matched;
}
