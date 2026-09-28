import { describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers/testConfig.js";

describe("GET /healthz", () => {
	test("reports ok and a version, unauthenticated", async () => {
		const app = buildApp(testConfig());
		const res = await app.inject({ method: "GET", url: "/healthz" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ ok: true });
		expect(typeof res.json().version).toBe("string");
	});
});

describe("startup guard", () => {
	test("refuses to build in production with no configured keys", () => {
		expect(() =>
			buildApp(testConfig({ nodeEnv: "production", apiKeyHashes: [] })),
		).toThrow(/CABN_API_KEY_SHA256/);
	});

	test("builds fine in production once keys are configured", () => {
		const hash = Buffer.alloc(32, 1);
		expect(() =>
			buildApp(testConfig({ nodeEnv: "production", apiKeyHashes: [hash] })),
		).not.toThrow();
	});

	test("in dev, POST /v1/worlds returns 503 rather than 401 or being open", async () => {
		const app = buildApp(
			testConfig({ nodeEnv: "development", apiKeyHashes: [] }),
		);
		const res = await app.inject({ method: "POST", url: "/v1/worlds" });
		expect(res.statusCode).toBe(503);
		expect(res.json()).toMatchObject({
			error: expect.stringContaining("no API keys"),
		});
	});
});
