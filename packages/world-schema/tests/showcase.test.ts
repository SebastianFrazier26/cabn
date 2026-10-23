import { describe, expect, test } from "vitest";
import {
	CABN_CONFIG_VERSION,
	CabnConfigValidationError,
	collectEmbedOrigins,
	EMPTY_SHOWCASE,
	EmbedOriginError,
	parseShowcase,
	SHOWCASE_VERSION,
	ShowcaseFileSchema,
	sitePortalId,
	validateCabnConfig,
	validateShelf,
} from "../src/index.js";

function baseConfig() {
	return {
		cabnConfigVersion: CABN_CONFIG_VERSION,
		allowedEmbedOrigins: ["https://demo.example.org"],
	};
}

function site(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		title: `Site ${id}`,
		url: "https://demo.example.org/",
		...extra,
	};
}

describe("cabn.json world info", () => {
	test("accepts title, description, links and order", () => {
		const config = validateCabnConfig({
			...baseConfig(),
			world: {
				title: "Climbing risk",
				description: "A short pitch.",
				links: [{ label: "Repo", url: "https://github.com/x/y" }],
				order: 2,
			},
		});
		expect(config.world?.order).toBe(2);
		expect(config.world?.links?.[0]?.label).toBe("Repo");
	});

	test("caps the description at 500 chars and links at 8", () => {
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				world: { description: "x".repeat(501) },
			}),
		).toThrow(CabnConfigValidationError);
		const links = Array.from({ length: 9 }, (_, i) => ({
			label: `l${i}`,
			url: "https://a.example/",
		}));
		expect(() =>
			validateCabnConfig({ ...baseConfig(), world: { links } }),
		).toThrow(CabnConfigValidationError);
	});

	test("rejects a non-https link and unknown world keys", () => {
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				world: { links: [{ label: "x", url: "http://a.example/" }] },
			}),
		).toThrow(CabnConfigValidationError);
		expect(() =>
			validateCabnConfig({ ...baseConfig(), world: { tagline: "x" } }),
		).toThrow(CabnConfigValidationError);
	});
});

describe("cabn.json sites", () => {
	test("accepts allowlisted sites with one hero", () => {
		const config = validateCabnConfig({
			...baseConfig(),
			sites: [site("live", { hero: true }), site("docs")],
		});
		expect(config.sites).toHaveLength(2);
	});

	test("rejects a site whose origin is not allowlisted", () => {
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				sites: [site("live", { url: "https://elsewhere.example/" })],
			}),
		).toThrow(/not listed in allowedEmbedOrigins/);
	});

	test("rejects more than one hero", () => {
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				sites: [site("a", { hero: true }), site("b", { hero: true })],
			}),
		).toThrow(/at most one site can be the hero/);
	});

	test("rejects duplicate ids, bad ids, http urls and more than 8 sites", () => {
		expect(() =>
			validateCabnConfig({ ...baseConfig(), sites: [site("a"), site("a")] }),
		).toThrow(/duplicate site id/);
		expect(() =>
			validateCabnConfig({ ...baseConfig(), sites: [site("Bad Id")] }),
		).toThrow(CabnConfigValidationError);
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				sites: [site("a", { url: "http://demo.example.org/" })],
			}),
		).toThrow(CabnConfigValidationError);
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				sites: Array.from({ length: 9 }, (_, i) => site(`s${i}`)),
			}),
		).toThrow(CabnConfigValidationError);
	});

	test("rejects an unsafe fallbackImage path", () => {
		expect(() =>
			validateCabnConfig({
				...baseConfig(),
				sites: [site("a", { fallbackImage: "../shot.png" })],
			}),
		).toThrow(CabnConfigValidationError);
	});
});

describe("showcase.json", () => {
	test("the writer schema accepts what the converter writes", () => {
		expect(() =>
			ShowcaseFileSchema.parse({
				showcaseVersion: SHOWCASE_VERSION,
				world: { title: "T" },
				sites: [{ portalId: sitePortalId("live"), hero: true }],
			}),
		).not.toThrow();
	});

	test("parseShowcase reads the hero, info and links", () => {
		const parsed = parseShowcase({
			showcaseVersion: SHOWCASE_VERSION,
			world: {
				title: "T",
				description: "D",
				links: [{ label: "Repo", url: "https://github.com/" }],
				order: 3,
			},
			sites: [
				{ portalId: sitePortalId("a"), hero: false },
				{ portalId: sitePortalId("b"), hero: true },
			],
		});
		expect(parsed).toEqual({
			title: "T",
			description: "D",
			links: [{ label: "Repo", url: "https://github.com/" }],
			order: 3,
			sitePortalIds: [sitePortalId("a"), sitePortalId("b")],
			heroPortalId: sitePortalId("b"),
		});
	});

	test("parseShowcase never throws: garbage or a future version is empty", () => {
		expect(parseShowcase(null)).toEqual(EMPTY_SHOWCASE);
		expect(parseShowcase("x")).toEqual(EMPTY_SHOWCASE);
		expect(parseShowcase({ showcaseVersion: 99, sites: [] })).toEqual(
			EMPTY_SHOWCASE,
		);
	});

	test("parseShowcase drops a malformed site or link and keeps the rest", () => {
		const parsed = parseShowcase({
			showcaseVersion: SHOWCASE_VERSION,
			world: {
				links: [
					{ label: "ok", url: "https://a.example/" },
					{ label: "bad", url: "javascript:alert(1)" },
				],
			},
			sites: [{ portalId: "README.md", hero: true }, { portalId: 3 }],
		});
		expect(parsed.links).toHaveLength(1);
		expect(parsed.sitePortalIds).toEqual([]);
		expect(parsed.heroPortalId).toBeNull();
	});
});

describe("shelf entries", () => {
	const entry = {
		id: "a",
		name: "a",
		worldUrl: "a/world.json",
		themeSeed: 1,
		fileCount: 1,
		totalBytes: 1,
	};
	const shelf = (world: Record<string, unknown>) => ({
		cabnVersion: 1,
		meta: { name: "s", generatedAt: new Date().toISOString() },
		worlds: [world],
	});

	test("an entry without the optional fields still validates", () => {
		expect(() => validateShelf(shelf(entry))).not.toThrow();
	});

	test("accepts description, links, heroUrl and order", () => {
		const parsed = validateShelf(
			shelf({
				...entry,
				description: "D",
				links: [{ label: "Repo", url: "https://github.com/" }],
				heroUrl: "https://demo.example.org/",
				order: 1,
			}),
		);
		expect(parsed.worlds[0]?.heroUrl).toBe("https://demo.example.org/");
	});

	test("rejects a non-https heroUrl and an over-long description", () => {
		expect(() =>
			validateShelf(shelf({ ...entry, heroUrl: "http://x.example/" })),
		).toThrow();
		expect(() =>
			validateShelf(shelf({ ...entry, description: "x".repeat(501) })),
		).toThrow();
	});
});

describe("collectEmbedOrigins", () => {
	test("unions, dedupes and sorts origins across configs and manifests", () => {
		expect(
			collectEmbedOrigins([
				{ allowedEmbedOrigins: ["https://b.example", "https://a.example"] },
				{ allowedEmbedOrigins: ["https://a.example"] },
				{},
			]),
		).toEqual(["https://a.example", "https://b.example"]);
	});

	test("fails closed on anything that is not an exact https origin", () => {
		for (const bad of [
			"*",
			"https://*.example.com",
			"https://a.example/path",
			"http://a.example",
			"https://a.example; script-src *",
			"https://a.example frame-ancestors",
			"",
		]) {
			expect(() =>
				collectEmbedOrigins([{ allowedEmbedOrigins: [bad] }]),
			).toThrow(EmbedOriginError);
		}
	});

	test("drops the host's own origin when asked", () => {
		expect(
			collectEmbedOrigins(
				[{ allowedEmbedOrigins: ["https://me.example", "https://a.example"] }],
				{ excludeOrigin: "https://me.example" },
			),
		).toEqual(["https://a.example"]);
	});
});
