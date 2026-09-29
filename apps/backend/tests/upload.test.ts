import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateManifest } from "@cabn/world-schema";
import type { FastifyInstance } from "fastify";
import { unzipSync, zipSync } from "fflate";
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

	test("hidden files in an upload never reach the result (2026-09-28)", async () => {
		const utf8 = (s: string) => new TextEncoder().encode(s);
		const zip = zipSync({
			"README.md": utf8("# hello\n"),
			"src/index.ts": utf8("export const a = 1;\n"),
			".env": utf8("SHADOW_CANARY_UPLOAD_ENV=1\n"),
			".github/ci.yml": utf8("on: push # SHADOW_CANARY_UPLOAD_CI\n"),
			"src/.eslintrc.json": utf8('{"c":"SHADOW_CANARY_UPLOAD_ESLINT"}\n'),
		});
		const { body, contentType } = buildMultipartBody([
			{ fieldName: "file", filename: "upload.zip", content: zip },
		]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(200);

		const entries = unzipSync(res.rawPayload);
		const manifest = JSON.parse(
			Buffer.from(entries["world.json"] as Uint8Array).toString("utf8"),
		);
		expect(manifest.portals.map((p: { id: string }) => p.id).sort()).toEqual([
			"README.md",
			"src/index.ts",
		]);
		for (const [key, value] of Object.entries(entries)) {
			expect(
				key.split("/").some((s) => s.startsWith(".")),
				key,
			).toBe(false);
			const text = Buffer.from(value).toString("utf8");
			expect(text, key).not.toContain("SHADOW_CANARY");
			for (const name of [".env", ".github", ".eslintrc"])
				expect(text, `${key} names ${name}`).not.toContain(name);
		}
	});

	test("media ships within the backend's own caps even if cabn.json asks for more", async () => {
		const png = (size: number) => {
			const bytes = new Uint8Array(size).fill(7);
			bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			return bytes;
		};
		const zip = zipSync({
			"cabn.json": new TextEncoder().encode(
				JSON.stringify({
					cabnConfigVersion: 1,
					media: { maxFileBytes: 20 * 1024 * 1024 },
				}),
			),
			"small.png": png(1024),
			"big.png": png(600 * 1024),
		});
		const { body, contentType } = buildMultipartBody([
			{ fieldName: "file", filename: "upload.zip", content: zip },
		]);
		const res = await post(body, contentType);
		expect(res.statusCode).toBe(200);

		const entries = unzipSync(res.rawPayload);
		const media = JSON.parse(
			Buffer.from(entries["media.json"] as Uint8Array).toString("utf8"),
		);
		expect(media.previews["big.png"]).toEqual({
			kind: "sealed",
			reason: "too-large",
		});
		const shipped = Object.keys(entries).filter((k) => k.startsWith("media/"));
		expect(shipped).toHaveLength(1);
		expect(entries[shipped[0] as string]?.length).toBe(1024);
	});

	test("never makes an outbound request for an upload's url previews (embed check stays offline)", async () => {
		const realFetch = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			throw new Error("backend must not fetch");
		}) as typeof fetch;
		try {
			const zip = zipSync({
				"cabn.json": new TextEncoder().encode(
					JSON.stringify({
						cabnConfigVersion: 1,
						previews: {
							"a.md": { kind: "url", url: "https://internal.example/" },
						},
						allowedEmbedOrigins: ["https://internal.example"],
					}),
				),
				"a.md": new TextEncoder().encode("# a\n"),
			});
			const { body, contentType } = buildMultipartBody([
				{ fieldName: "file", filename: "upload.zip", content: zip },
			]);
			const res = await post(body, contentType);
			expect(res.statusCode).toBe(200);
			expect(calls).toBe(0);
			const embeds = JSON.parse(
				Buffer.from(
					unzipSync(res.rawPayload)["embeds.json"] as Uint8Array,
				).toString("utf8"),
			);
			expect(embeds.mode).toBe("offline");
			expect(embeds.entries["a.md"]).toMatchObject({
				framable: true,
				basis: "offline",
			});
		} finally {
			globalThis.fetch = realFetch;
		}
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
