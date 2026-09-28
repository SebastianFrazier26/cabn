import { describe, expect, test } from "vitest";
import {
	CabnConfigSchema,
	EMBED_INDEX_VERSION,
	EmbedIndexFileSchema,
	parseEmbedIndex,
} from "../src/index.js";

const url = "https://threejs.org/";

describe("embeds.json", () => {
	test("strict schema accepts what the converter writes", () => {
		expect(
			EmbedIndexFileSchema.safeParse({
				embedsVersion: EMBED_INDEX_VERSION,
				mode: "network",
				entries: {
					"docs/a.md": { url, framable: true, basis: "headers" },
					"docs/b.md": {
						url: "https://example.org/",
						framable: false,
						basis: "headers",
						detail: "X-Frame-Options: deny",
					},
				},
			}).success,
		).toBe(true);
	});

	test("strict schema rejects http urls and unknown bases", () => {
		for (const entry of [
			{ url: "http://x.org/", framable: true, basis: "headers" },
			{ url, framable: true, basis: "guess" },
			{ url, framable: "no", basis: "headers" },
		]) {
			expect(
				EmbedIndexFileSchema.safeParse({
					embedsVersion: 1,
					mode: "network",
					entries: { a: entry },
				}).success,
			).toBe(false);
		}
	});

	test("parser keeps good entries, drops bad ones, never throws", () => {
		const parsed = parseEmbedIndex({
			embedsVersion: 1,
			mode: "network",
			entries: {
				ok: { url, framable: false, basis: "headers", detail: "d" },
				future: { url, framable: true, basis: "tomorrow", extra: 1 },
				bad: { url: "javascript:alert(1)", framable: false, basis: "headers" },
				junk: 42,
			},
		});
		expect(parsed.get("ok")).toEqual({ url, framable: false, detail: "d" });
		expect(parsed.get("future")).toEqual({ url, framable: true });
		expect(parsed.has("bad")).toBe(false);
		expect(parsed.has("junk")).toBe(false);
	});

	test.each([
		undefined,
		null,
		"<html>",
		{},
		{ embedsVersion: 2, entries: {} },
		{ embedsVersion: 1 },
	])("degrades %o to no verdicts", (json) => {
		expect(parseEmbedIndex(json).size).toBe(0);
	});
});

describe("cabn.json embedCheck", () => {
	test("optional boolean", () => {
		const base = { cabnConfigVersion: 1 };
		expect(CabnConfigSchema.parse(base).embedCheck).toBeUndefined();
		expect(
			CabnConfigSchema.parse({ ...base, embedCheck: false }).embedCheck,
		).toBe(false);
		expect(
			CabnConfigSchema.safeParse({ ...base, embedCheck: "off" }).success,
		).toBe(false);
	});
});
