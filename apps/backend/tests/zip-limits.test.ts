import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { checkZipLimits, RATIO_CHECK_MIN_BYTES } from "../src/zip-limits.js";

const limits = {
	maxInflationBytes: 10 * 1024 * 1024,
	maxCompressionRatio: 100,
};

describe("checkZipLimits", () => {
	test("passes an ordinary archive", () => {
		const zip = zipSync({
			"a.txt": new TextEncoder().encode("hello\n"),
			"b.bin": randomBytes(200 * 1024),
		});
		expect(checkZipLimits(zip, limits)).toEqual({ ok: true });
	});

	test("rejects an entry declared past the ratio cap", () => {
		const zip = zipSync({ "zeros.bin": new Uint8Array(2 * 1024 * 1024) });
		expect(checkZipLimits(zip, limits)).toEqual({ ok: false, reason: "ratio" });
	});

	test("the ratio cap is configurable", () => {
		const zip = zipSync({ "zeros.bin": new Uint8Array(2 * 1024 * 1024) });
		expect(
			checkZipLimits(zip, { ...limits, maxCompressionRatio: 10_000 }),
		).toEqual({ ok: true });
	});

	test("small entries are exempt from the ratio cap", () => {
		const zip = zipSync({
			"spaces.txt": new Uint8Array(RATIO_CHECK_MIN_BYTES - 1).fill(32),
		});
		expect(checkZipLimits(zip, limits)).toEqual({ ok: true });
	});

	test("rejects an archive whose declared total passes the inflation cap", () => {
		const zip = zipSync({
			"a.bin": randomBytes(600 * 1024),
			"b.bin": randomBytes(600 * 1024),
		});
		expect(
			checkZipLimits(zip, { ...limits, maxInflationBytes: 1024 * 1024 }),
		).toEqual({ ok: false, reason: "inflation" });
	});

	test("rejects the converter's zip-bomb fixture on ratio without inflating it", async () => {
		const bytes = await readFile(
			join(
				import.meta.dirname,
				"../../../packages/converter/test/fixtures/hostile-zip-bomb.zip",
			),
		);
		expect(
			checkZipLimits(bytes, {
				...limits,
				maxInflationBytes: 100 * 1024 * 1024,
			}),
		).toEqual({ ok: false, reason: "ratio" });
	});

	test("an archive with no readable central directory is refused, not waved through", () => {
		const zip = zipSync({ "a.txt": new TextEncoder().encode("hi") });
		const truncated = zip.subarray(0, zip.length - 22);
		expect(checkZipLimits(truncated, limits)).toEqual({
			ok: false,
			reason: "unreadable",
		});
	});
});
