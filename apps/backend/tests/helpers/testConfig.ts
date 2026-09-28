import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../../src/config.js";

/** A fresh plaintext key + the hex SHA-256 hash a config would store for it. */
export function makeApiKey(): { plaintext: string; sha256Hex: string } {
	const plaintext = `cabn_${randomBytes(16).toString("hex")}`;
	return {
		plaintext,
		sha256Hex: createHash("sha256").update(plaintext).digest("hex"),
	};
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		nodeEnv: "test",
		port: 0,
		host: "127.0.0.1",
		maxUploadBytes: 25 * 1024 * 1024,
		corsOrigins: [],
		apiKeyHashes: [],
		trustProxy: false,
		requestTimeoutMs: 30_000,
		rateLimitMax: 20,
		rateLimitWindowMs: 60_000,
		...overrides,
	};
}
