import { describe, expect, test } from "vitest";
import { ConfigError, loadConfig, sha256Hex } from "../src/config.js";

describe("loadConfig", () => {
	test("applies defaults when env is empty", () => {
		const config = loadConfig({});
		expect(config.port).toBe(8080);
		expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
		expect(config.corsOrigins).toEqual([]);
		expect(config.apiKeyHashes).toEqual([]);
		expect(config.trustProxy).toBe(false);
		expect(config.rateLimitMax).toBe(20);
	});

	test("parses a comma-separated CORS allowlist", () => {
		const config = loadConfig({
			CORS_ORIGINS: "https://a.example, https://b.example",
		});
		expect(config.corsOrigins).toEqual([
			"https://a.example",
			"https://b.example",
		]);
	});

	test("parses valid comma-separated SHA-256 hashes", () => {
		const h1 = sha256Hex("one");
		const h2 = sha256Hex("two");
		const config = loadConfig({ CABN_API_KEY_SHA256: `${h1}, ${h2}` });
		expect(config.apiKeyHashes).toHaveLength(2);
		expect(config.apiKeyHashes[0]?.toString("hex")).toBe(h1);
		expect(config.apiKeyHashes[1]?.toString("hex")).toBe(h2);
	});

	test("rejects a malformed hash", () => {
		expect(() => loadConfig({ CABN_API_KEY_SHA256: "not-a-hash" })).toThrow(
			ConfigError,
		);
	});

	test("CABN_TRUST_PROXY only enables on the literal string 'true'", () => {
		expect(loadConfig({ CABN_TRUST_PROXY: "true" }).trustProxy).toBe(true);
		expect(loadConfig({ CABN_TRUST_PROXY: "1" }).trustProxy).toBe(false);
		expect(loadConfig({}).trustProxy).toBe(false);
	});
});
