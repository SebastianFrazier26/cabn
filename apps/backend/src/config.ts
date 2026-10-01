import { createHash } from "node:crypto";
import { z } from "zod";

export interface AppConfig {
	nodeEnv: string;
	port: number;
	host: string;
	maxUploadBytes: number;
	corsOrigins: string[];
	/** SHA-256 digests of valid keys, 32 bytes each — never the plaintext keys themselves (see auth.ts). */
	apiKeyHashes: Buffer[];
	/**
	 * How many proxies in front of the app to trust in X-Forwarded-For (0 =
	 * none). Railway is 1. A count, never `true`: with `true` Fastify takes the
	 * leftmost entry, which the client writes itself, so a spoofed header got
	 * a fresh per-IP rate-limit bucket on every request.
	 */
	trustProxy: number;
	requestTimeoutMs: number;
	rateLimitMax: number;
	rateLimitWindowMs: number;
	/** Conversions running at once (1-10); past it POST /v1/worlds answers 503. */
	converterPoolConcurrency: number;
	/** Wall-clock budget per conversion; the worker is terminated and the request gets 504. */
	converterPoolTimeoutMs: number;
	/** Cap on the archive's declared total uncompressed size; above it, 422. */
	maxZipInflationBytes: number;
	/** Cap on any one entry's declared uncompressed:compressed ratio; above it, 422. */
	maxCompressionRatio: number;
	/** V8 old-generation heap cap per conversion worker. */
	converterPoolHeapLimitMb: number;
}

export class ConfigError extends Error {}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

function parseApiKeyHashes(raw: string | undefined): Buffer[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((hex) => {
			if (!HEX_SHA256.test(hex)) {
				throw new ConfigError(
					"CABN_API_KEY_SHA256 must be a comma-separated list of 64-character hex SHA-256 hashes",
				);
			}
			return Buffer.from(hex.toLowerCase(), "hex");
		});
}

function parseOrigins(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

// "true"/"false" are the values this variable took before it was a hop
// count; "true" meant one proxy (Railway), so it maps to 1 rather than
// failing an already configured deploy at boot.
const TrustProxySchema = z.union([
	z.literal("true").transform(() => 1),
	z.literal("false").transform(() => 0),
	z
		.string()
		.regex(/^\d{1,2}$/)
		.transform(Number)
		.pipe(z.number().int().min(0).max(10)),
]);

function parseTrustProxy(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return 0;
	const parsed = TrustProxySchema.safeParse(raw.trim());
	if (!parsed.success) {
		throw new ConfigError(
			"CABN_TRUST_PROXY must be the number of proxies in front of the app, 0-10 (Railway: 1)",
		);
	}
	return parsed.data;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const maxUploadBytes = parsePositiveInt(
		env.MAX_UPLOAD_BYTES,
		25 * 1024 * 1024,
	);
	return {
		nodeEnv: env.NODE_ENV ?? "development",
		port: parsePositiveInt(env.PORT, 8080),
		host: env.HOST ?? "0.0.0.0",
		maxUploadBytes,
		corsOrigins: parseOrigins(env.CORS_ORIGINS),
		apiKeyHashes: parseApiKeyHashes(env.CABN_API_KEY_SHA256),
		trustProxy: parseTrustProxy(env.CABN_TRUST_PROXY),
		requestTimeoutMs: parsePositiveInt(env.REQUEST_TIMEOUT_MS, 30_000),
		rateLimitMax: parsePositiveInt(env.RATE_LIMIT_MAX, 20),
		rateLimitWindowMs: parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
		converterPoolConcurrency: Math.min(
			10,
			parsePositiveInt(env.CONVERTER_POOL_CONCURRENCY, 2),
		),
		converterPoolTimeoutMs: parsePositiveInt(
			env.CONVERTER_POOL_TIMEOUT_MS,
			30_000,
		),
		maxZipInflationBytes: parsePositiveInt(
			env.MAX_ZIP_INFLATION_BYTES,
			maxUploadBytes * 4,
		),
		maxCompressionRatio: parsePositiveInt(env.MAX_COMPRESSION_RATIO, 100),
		converterPoolHeapLimitMb: parsePositiveInt(
			env.CONVERTER_POOL_HEAP_LIMIT_MB,
			256,
		),
	};
}

export function sha256Hex(input: string | Buffer): string {
	return createHash("sha256").update(input).digest("hex");
}
