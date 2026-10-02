import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, test } from "vitest";
import { ConverterPool, type PoolConfig } from "../src/converter-pool.js";
import { makeValidZip } from "./helpers/testZip.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

const pools: ConverterPool[] = [];
function pool(overrides: Partial<PoolConfig> = {}): ConverterPool {
	const p = new ConverterPool({
		concurrency: 2,
		timeoutMs: 10_000,
		maxZipInflationBytes: 100 * 1024 * 1024,
		maxCompressionRatio: 100,
		mediaMaxTotalBytes: 25 * 1024 * 1024,
		heapLimitMb: 256,
		...overrides,
	});
	pools.push(p);
	return p;
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await new Promise((r) => setTimeout(r, 10));
	}
}

afterEach(async () => {
	await Promise.all(pools.splice(0).map((p) => p.shutdown()));
});

describe("ConverterPool", () => {
	test("converts a real upload in the built worker", async () => {
		const outcome = await pool().convert(makeValidZip());
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(Object.keys(unzipSync(outcome.zip))).toContain("world.json");
	});

	test("a conversion stuck in a sync loop is terminated at the deadline, and the main thread keeps running", async () => {
		const p = pool({
			timeoutMs: 400,
			workerFile: join(FIXTURES, "hang-worker.mjs"),
		});
		let ticks = 0;
		const ticker = setInterval(() => ticks++, 20);
		const started = Date.now();
		const outcome = await p.convert(makeValidZip());
		clearInterval(ticker);

		expect(outcome).toEqual({ kind: "timeout" });
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(ticks).toBeGreaterThan(5);
		// The slot frees only once the thread has really exited.
		await until(() => p.activeCount === 0);
	});

	test("past the concurrency limit it answers busy at once, and frees slots after termination", async () => {
		const p = pool({
			concurrency: 2,
			timeoutMs: 500,
			workerFile: join(FIXTURES, "hang-worker.mjs"),
		});
		const first = p.convert(makeValidZip());
		const second = p.convert(makeValidZip());
		expect(p.activeCount).toBe(2);
		expect(await p.convert(makeValidZip())).toEqual({ kind: "busy" });

		expect(await first).toEqual({ kind: "timeout" });
		expect(await second).toEqual({ kind: "timeout" });
		await until(() => p.activeCount === 0);
		const next = p.convert(makeValidZip());
		expect(p.activeCount).toBe(1);
		expect(await next).toEqual({ kind: "timeout" });
	});

	test("the worker starts with an empty environment", async () => {
		process.env.CABN_API_KEY_SHA256 = "a".repeat(64);
		process.env.CABN_TEST_CANARY_SECRET = "canary";
		try {
			const outcome = await pool({
				workerFile: join(FIXTURES, "env-worker.mjs"),
			}).convert(makeValidZip());
			expect(outcome.kind).toBe("ok");
			if (outcome.kind !== "ok") return;
			const env = JSON.parse(new TextDecoder().decode(outcome.zip));
			expect(env).toEqual({});
		} finally {
			delete process.env.CABN_API_KEY_SHA256;
			delete process.env.CABN_TEST_CANARY_SECRET;
		}
	});

	test("the heap cap ends a runaway allocation as a failure, not a crash", async () => {
		const outcome = await pool({
			heapLimitMb: 32,
			workerFile: join(FIXTURES, "oom-worker.mjs"),
		}).convert(makeValidZip());
		expect(outcome).toEqual({
			kind: "failed",
			detail: "ERR_WORKER_OUT_OF_MEMORY",
		});
	});

	test("an upload that is a view into a larger buffer is copied, not detached", async () => {
		const zip = makeValidZip();
		const backing = new Uint8Array(zip.length + 64);
		backing.set(zip, 32);
		const view = backing.subarray(32, 32 + zip.length);

		const outcome = await pool().convert(view);
		expect(outcome.kind).toBe("ok");
		expect(backing.byteLength).toBe(zip.length + 64);
		expect(view.byteLength).toBe(zip.length);
	});
});
