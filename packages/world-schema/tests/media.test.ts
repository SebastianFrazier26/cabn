import { describe, expect, test } from "vitest";
import {
	CabnConfigSchema,
	MEDIA_MAX_FILE_BYTES_LIMIT,
	MEDIA_MAX_TOTAL_BYTES_LIMIT,
	MediaIndexFileSchema,
	parseMediaIndex,
} from "../src/index.js";

const baseConfig = { cabnConfigVersion: 1 };
const asset = "media/0123456789abcdef.wav";

describe("cabn.json media caps", () => {
	test("optional; accepts values up to the hard ceilings", () => {
		expect(CabnConfigSchema.parse(baseConfig).media).toBeUndefined();
		const parsed = CabnConfigSchema.parse({
			...baseConfig,
			media: {
				maxFileBytes: MEDIA_MAX_FILE_BYTES_LIMIT,
				maxTotalBytes: MEDIA_MAX_TOTAL_BYTES_LIMIT,
			},
		});
		expect(parsed.media?.maxFileBytes).toBe(MEDIA_MAX_FILE_BYTES_LIMIT);
		expect(
			CabnConfigSchema.parse({ ...baseConfig, media: { maxTotalBytes: 0 } })
				.media,
		).toEqual({ maxTotalBytes: 0 });
	});

	test.each([
		{ maxFileBytes: MEDIA_MAX_FILE_BYTES_LIMIT + 1 },
		{ maxTotalBytes: MEDIA_MAX_TOTAL_BYTES_LIMIT + 1 },
		{ maxFileBytes: 0 },
		{ maxFileBytes: 1.5 },
		{ maxTotalBytes: -1 },
		{ maxFileBytes: "5MB" },
		{ unknownKnob: 1 },
	])("rejects %o", (media) => {
		expect(CabnConfigSchema.safeParse({ ...baseConfig, media }).success).toBe(
			false,
		);
	});
});

describe("media.json", () => {
	test("asset paths are pinned to media/<16 hex>.<known ext>", () => {
		const ok = {
			mediaVersion: 1,
			totalBytes: 10,
			previews: { "a.wav": { kind: "audio", asset, bytes: 10, format: "wav" } },
		};
		expect(MediaIndexFileSchema.safeParse(ok).success).toBe(true);
		for (const bad of [
			"//evil.example/x.wav",
			"/media/0123456789abcdef.wav",
			"media/../world.json",
			"media/0123456789abcdef.svg",
			"media/0123456789abcdef.html",
		]) {
			const doc = structuredClone(ok);
			doc.previews["a.wav"].asset = bad;
			expect(MediaIndexFileSchema.safeParse(doc).success).toBe(false);
		}
	});

	test("parseMediaIndex never throws and drops only the entries it can't read", () => {
		expect(parseMediaIndex(undefined).size).toBe(0);
		expect(parseMediaIndex("<!doctype html>").size).toBe(0);
		expect(parseMediaIndex({ mediaVersion: 2, previews: {} }).size).toBe(0);
		const parsed = parseMediaIndex({
			mediaVersion: 1,
			totalBytes: 0,
			previews: {
				"a.wav": { kind: "audio", asset, bytes: 10, format: "wav" },
				"b.xyz": { kind: "hologram", asset },
				"c.pdf": { kind: "pdf", asset: "https://evil.example/c.pdf", bytes: 1 },
				"d.bin": { kind: "sealed", reason: "too-large" },
			},
		});
		expect([...parsed.keys()].sort()).toEqual(["a.wav", "d.bin"]);
	});
});
