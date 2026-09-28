import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateManifest } from "@cabn/world-schema";
import type { FastifyInstance } from "fastify";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { buildMultipartBody } from "./helpers/multipart.js";
import { makeApiKey, testConfig } from "./helpers/testConfig.js";
import { makeValidZip } from "./helpers/testZip.js";

const CONVERTER_FIXTURES = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"packages",
	"converter",
	"test",
	"fixtures",
);

describe("POST /v1/worlds: auth", () => {
	const { plaintext, sha256Hex: hash } = makeApiKey();
	let app: FastifyInstance;

	beforeEach(() => {
		app = buildApp(testConfig({ apiKeyHashes: [Buffer.from(hash, "hex")] }));
	});
	afterEach(() => app.close());

	test("401 with no Authorization header", async () => {
		const res = await app.inject({ method: "POST", url: "/v1/worlds" });
		expect(res.statusCode).toBe(401);
		expect(res.json()).toEqual({ error: "unauthorized" });
	});

	test("401 with the wrong scheme", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/v1/worlds",
			headers: { authorization: `Basic ${plaintext}` },
		});
		expect(res.statusCode).toBe(401);
	});

	test("401 with an empty token", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/v1/worlds",
			headers: { authorization: "Bearer " },
		});
		expect(res.statusCode).toBe(401);
	});

	test("401 with a wrong key", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/v1/worlds",
			headers: { authorization: "Bearer cabn_totally-wrong" },
		});
		expect(res.statusCode).toBe(401);
	});

	test("a valid key passes auth (gets past 401, onto multipart handling)", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/v1/worlds",
			headers: { authorization: `Bearer ${plaintext}` },
		});
		// No file was sent — auth passed, so the failure is "no file provided", not 401.
		expect(res.statusCode).toBe(400);
	});
});

describe("POST /v1/worlds: upload handling", () => {
	const { plaintext, sha256Hex: hash } = makeApiKey();
	let app: FastifyInstance;

	beforeEach(() => {
		app = buildApp(testConfig({ apiKeyHashes: [Buffer.from(hash, "hex")] }));
	});
	afterEach(() => app.close());

	function post(body: Buffer, contentType: string) {
		return app.inject({
			method: "POST",
			url: "/v1/worlds",
			headers: {
				authorization: `Bearer ${plaintext}`,
				"content-type": contentType,
			},
			payload: body,
		});
	}

	test("200: valid zip returns a world bundle whose world.json validates", async () => {
		const { body, contentType } = buildMultipartBody([
			{ fieldName: "file", filename: "upload.zip", content: makeValidZip() },
		]);
		const res = await post(body, contentType);

		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toBe("application/zip");

		const entries = unzipSync(res.rawPayload);
		expect(entries["world.json"]).toBeDefined();
		const manifest = JSON.parse(
			Buffer.from(entries["world.json"] as Uint8Array).toString("utf8"),
		);
		expect(() => validateManifest(manifest)).not.toThrow();
	});

	test("400: no file field at all", async () => {
		const { body, contentType } = buildMultipartBody([]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(400);
	});

	test("400: more than one file", async () => {
		const { body, contentType } = buildMultipartBody([
			{ fieldName: "file", filename: "a.zip", content: makeValidZip() },
			{ fieldName: "file2", filename: "b.zip", content: makeValidZip() },
		]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(400);
	});

	test("415: renamed non-zip file (magic bytes checked, not just filename)", async () => {
		const { body, contentType } = buildMultipartBody([
			{
				fieldName: "file",
				filename: "upload.zip",
				content: new TextEncoder().encode("just some plain text, not a zip"),
			},
		]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(415);
	});

	test("413: file over the configured cap", async () => {
		const smallCapApp = buildApp(
			testConfig({
				apiKeyHashes: [Buffer.from(hash, "hex")],
				maxUploadBytes: 1024,
			}),
		);
		try {
			const oversized = new Uint8Array(2048).fill(1);
			const { body, contentType } = buildMultipartBody([
				{ fieldName: "file", filename: "big.zip", content: oversized },
			]);
			const res = await smallCapApp.inject({
				method: "POST",
				url: "/v1/worlds",
				headers: {
					authorization: `Bearer ${plaintext}`,
					"content-type": contentType,
				},
				payload: body,
			});
			expect(res.statusCode).toBe(413);
		} finally {
			await smallCapApp.close();
		}
	});

	test("hostile zip-slip fixture is handled safely (capped, not crashed)", async () => {
		const bytes = await readFile(
			join(CONVERTER_FIXTURES, "hostile-zip-slip.zip"),
		);
		const { body, contentType } = buildMultipartBody([
			{ fieldName: "file", filename: "evil.zip", content: bytes },
		]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(200);
		const entries = unzipSync(res.rawPayload);
		const manifest = JSON.parse(
			Buffer.from(entries["world.json"] as Uint8Array).toString("utf8"),
		);
		expect(() => validateManifest(manifest)).not.toThrow();
	});

	test("hostile zip-bomb fixture is handled safely (capped, not crashed)", async () => {
		const bytes = await readFile(
			join(CONVERTER_FIXTURES, "hostile-zip-bomb.zip"),
		);
		const { body, contentType } = buildMultipartBody([
			{ fieldName: "file", filename: "bomb.zip", content: bytes },
		]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(200);
		const entries = unzipSync(res.rawPayload);
		const manifest = JSON.parse(
			Buffer.from(entries["world.json"] as Uint8Array).toString("utf8"),
		);
		expect(() => validateManifest(manifest)).not.toThrow();
	});
});

describe("POST /v1/worlds: rate limiting", () => {
	test("429 once the per-key limit is exceeded", async () => {
		const { plaintext, sha256Hex: hash } = makeApiKey();
		const app = buildApp(
			testConfig({
				apiKeyHashes: [Buffer.from(hash, "hex")],
				rateLimitMax: 2,
				rateLimitWindowMs: 60_000,
			}),
		);
		try {
			const results = [];
			for (let i = 0; i < 3; i++) {
				results.push(
					await app.inject({
						method: "POST",
						url: "/v1/worlds",
						headers: { authorization: `Bearer ${plaintext}` },
					}),
				);
			}
			expect(results[0]?.statusCode).toBe(400); // no file, but past auth+rate-limit
			expect(results[1]?.statusCode).toBe(400);
			expect(results[2]?.statusCode).toBe(429);
		} finally {
			await app.close();
		}
	});
});
