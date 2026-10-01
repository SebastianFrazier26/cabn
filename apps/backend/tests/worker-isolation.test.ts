import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { zipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { type BuildAppOptions, buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { buildMultipartBody } from "./helpers/multipart.js";
import { makeApiKey, testConfig } from "./helpers/testConfig.js";
import { makeValidZip } from "./helpers/testZip.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const { plaintext, sha256Hex: hash } = makeApiKey();

const apps: FastifyInstance[] = [];
function app(
	overrides: Partial<AppConfig> = {},
	opts: BuildAppOptions = {},
): FastifyInstance {
	const a = buildApp(
		testConfig({ apiKeyHashes: [Buffer.from(hash, "hex")], ...overrides }),
		opts,
	);
	apps.push(a);
	return a;
}

afterEach(async () => {
	await Promise.all(apps.splice(0).map((a) => a.close()));
});

function upload(target: FastifyInstance, zip: Uint8Array = makeValidZip()) {
	const { body, contentType } = buildMultipartBody([
		{ fieldName: "file", filename: "upload.zip", content: zip },
	]);
	return target.inject({
		method: "POST",
		url: "/v1/worlds",
		headers: {
			authorization: `Bearer ${plaintext}`,
			"content-type": contentType,
		},
		payload: body,
	});
}

const worker = (name: string) => ({
	converterWorkerFile: join(FIXTURES, name),
});

describe("POST /v1/worlds: worker isolation", () => {
	test("504 when a conversion hangs, and /healthz answers promptly meanwhile", async () => {
		const a = app({ converterPoolTimeoutMs: 1_000 }, worker("hang-worker.mjs"));
		const pending = upload(a);
		await new Promise((r) => setTimeout(r, 150));

		const started = Date.now();
		const health = await a.inject({ method: "GET", url: "/healthz" });
		expect(health.statusCode).toBe(200);
		expect(Date.now() - started).toBeLessThan(250);

		const res = await pending;
		expect(res.statusCode).toBe(504);
		expect(res.json()).toEqual({ error: "conversion timed out" });
	});

	test("503 with retry-after once every conversion slot is taken", async () => {
		const a = app(
			{ converterPoolConcurrency: 1, converterPoolTimeoutMs: 1_000 },
			worker("hang-worker.mjs"),
		);
		const first = upload(a);
		await new Promise((r) => setTimeout(r, 150));

		const second = await upload(a);
		expect(second.statusCode).toBe(503);
		expect(second.headers["retry-after"]).toBe("5");
		expect((await first).statusCode).toBe(504);
	});

	test("the worker's environment carries no API key hashes or other host secrets", async () => {
		process.env.CABN_API_KEY_SHA256 = hash;
		process.env.CABN_TEST_CANARY_SECRET = "canary";
		try {
			const res = await upload(app({}, worker("env-worker.mjs")));
			expect(res.statusCode).toBe(200);
			expect(res.body).not.toContain(hash);
			expect(res.body).not.toContain("canary");
			expect(JSON.parse(res.body)).toEqual({});
		} finally {
			delete process.env.CABN_API_KEY_SHA256;
			delete process.env.CABN_TEST_CANARY_SECRET;
		}
	});

	test("a crashing worker is a generic 422 that leaks none of its error", async () => {
		const res = await upload(app({}, worker("throw-worker.mjs")));
		expect(res.statusCode).toBe(422);
		expect(res.json()).toEqual({
			error: "could not convert the uploaded archive",
		});
		expect(res.body).not.toContain("INTERNAL_DETAIL");
	});

	test("422 when the archive declares more than the inflation cap", async () => {
		const zip = zipSync({
			"a.bin": randomBytes(48 * 1024),
			"b.bin": randomBytes(48 * 1024),
		});
		const res = await upload(app({ maxZipInflationBytes: 64 * 1024 }), zip);
		expect(res.statusCode).toBe(422);
		expect(res.json()).toEqual({
			error: "archive would inflate past the size limit",
		});
	});

	test("422 when an entry declares a ratio past the cap; a raised cap lets it through", async () => {
		const zip = zipSync({
			"README.md": new TextEncoder().encode("# hi\n"),
			"zeros.bin": new Uint8Array(1024 * 1024),
		});
		const res = await upload(app(), zip);
		expect(res.statusCode).toBe(422);
		expect(res.json()).toEqual({
			error: "archive has an entry compressed beyond the allowed ratio",
		});

		const raised = await upload(app({ maxCompressionRatio: 100_000 }), zip);
		expect(raised.statusCode).toBe(200);
	});
});
