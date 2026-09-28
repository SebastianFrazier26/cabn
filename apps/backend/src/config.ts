import { createHash } from "node:crypto";

export interface AppConfig {
	nodeEnv: string;
	port: number;
	host: string;
	maxUploadBytes: number;
	corsOrigins: string[];
	/** SHA-256 digests of valid keys, 32 bytes each — never the plaintext keys themselves (see auth.ts). */
	apiKeyHashes: Buffer[];
	/** Railway (and most PaaS) put the app behind a proxy; rate-limit and CORS both key off `request.ip`, which only reflects the real client when Fastify trusts X-Forwarded-For. */
	trustProxy: boolean;
	requestTimeoutMs: number;
	rateLimitMax: number;
	rateLimitWindowMs: number;
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	return {
		nodeEnv: env.NODE_ENV ?? "development",
		port: parsePositiveInt(env.PORT, 8080),
		host: env.HOST ?? "0.0.0.0",
		maxUploadBytes: parsePositiveInt(env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024),
		corsOrigins: parseOrigins(env.CORS_ORIGINS),
		apiKeyHashes: parseApiKeyHashes(env.CABN_API_KEY_SHA256),
		trustProxy: env.CABN_TRUST_PROXY === "true",
		requestTimeoutMs: parsePositiveInt(env.REQUEST_TIMEOUT_MS, 30_000),
		rateLimitMax: parsePositiveInt(env.RATE_LIMIT_MAX, 20),
		rateLimitWindowMs: parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
	};
}

export function sha256Hex(input: string | Buffer): string {
	return createHash("sha256").update(input).digest("hex");
}
