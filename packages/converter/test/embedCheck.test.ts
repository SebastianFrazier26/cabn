import type { EmbedIndexFile } from "@cabn/world-schema";
import { zipSync } from "fflate";
import { describe, expect, test, vi } from "vitest";
import { convert } from "../src/convert.js";
import {
	checkEmbedUrl,
	checkEmbedUrls,
	type EmbedFetch,
	type EmbedFetchResponse,
	evaluateFramingHeaders,
	frameAncestorsLists,
	sourceListAllowsAnyEmbedder,
	xFrameOptionsBlocks,
} from "../src/embedCheck.js";
import { ZipSource } from "../src/sources/zip.js";

const verdict = (xfo: string | null, csp: string | null = null) =>
	evaluateFramingHeaders({ xFrameOptions: xfo, contentSecurityPolicy: csp });

describe("X-Frame-Options", () => {
	test.each([
		["DENY", true],
		["deny", true],
		["  Deny  ", true],
		["SAMEORIGIN", true],
		["sameorigin, sameorigin", true],
		["DENY, DENY", true],
		["ALLOWALL", false],
		["ALLOW-FROM https://example.com/", false],
		["garbage", false],
		["", false],
		// Conflicting multiple values block, per the HTML spec.
		["SAMEORIGIN, DENY", true],
		["ALLOWALL, DENY", true],
		["allowall, garbage", true],
		// Several values none of which mean anything are ignored.
		["garbage, nonsense", false],
	])("%j blocks: %s", (value, blocks) => {
		expect(xFrameOptionsBlocks(value)).toBe(blocks);
	});
});

describe("CSP frame-ancestors parsing", () => {
	test("finds the directive case-insensitively across ;-separated directives", () => {
		expect(
			frameAncestorsLists(
				"default-src 'self'; FRAME-ANCESTORS 'self' https://a.example ;img-src *",
			),
		).toEqual([["'self'", "https://a.example"]]);
	});

	test("only the first occurrence in a policy counts", () => {
		expect(
			frameAncestorsLists("frame-ancestors 'none'; frame-ancestors *"),
		).toEqual([["'none'"]]);
	});

	test("comma-separated policies are each parsed", () => {
		expect(
			frameAncestorsLists(
				"frame-ancestors *, default-src x; frame-ancestors 'self'",
			),
		).toEqual([["*"], ["'self'"]]);
	});

	test("an empty directive value is an empty list", () => {
		expect(frameAncestorsLists("frame-ancestors;script-src 'self'")).toEqual([
			[],
		]);
	});

	test("no directive, no lists", () => {
		expect(
			frameAncestorsLists("default-src 'none'; script-src 'self'"),
		).toEqual([]);
		// Not a prefix match.
		expect(frameAncestorsLists("frame-ancestorsx *")).toEqual([]);
	});

	test.each([
		[["*"], true],
		[["https:"], true],
		[["HTTPS:"], true],
		[["http:"], true],
		[["'none'"], false],
		[["'self'"], false],
		[[], false],
		[["https://example.com"], false],
		[["*.example.com"], false],
		[["https://*"], false],
		[["'none'", "*"], true],
		[["'self'", "https:"], true],
		[["data:"], false],
	])("%j allows any embedder: %s", (sources, allows) => {
		expect(sourceListAllowsAnyEmbedder(sources)).toBe(allows);
	});
});

describe("evaluateFramingHeaders", () => {
	test("no headers is framable", () => {
		expect(verdict(null)).toEqual({ framable: true });
	});

	test("XFO deny blocks with a readable detail", () => {
		expect(verdict("DENY")).toEqual({
			framable: false,
			detail: "X-Frame-Options: deny",
		});
	});

	test("frame-ancestors overrides XFO in both directions", () => {
		expect(verdict("DENY", "frame-ancestors *").framable).toBe(true);
		expect(verdict(null, "frame-ancestors 'self'")).toEqual({
			framable: false,
			detail: "CSP frame-ancestors 'self'",
		});
		expect(verdict("ALLOWALL", "frame-ancestors 'none'").framable).toBe(false);
	});

	test("a CSP without frame-ancestors leaves XFO in charge", () => {
		expect(verdict("SAMEORIGIN", "default-src 'self'").framable).toBe(false);
		expect(verdict(null, "default-src 'none'").framable).toBe(true);
	});

	test("every policy carrying frame-ancestors must allow", () => {
		expect(
			verdict(null, "frame-ancestors *, frame-ancestors https:").framable,
		).toBe(true);
		expect(
			verdict(null, "frame-ancestors *, frame-ancestors https://only.example")
				.framable,
		).toBe(false);
	});

	test("host lists are blocked, empty list reads as (empty)", () => {
		expect(
			verdict(null, "frame-ancestors https://a.example https://b.example"),
		).toEqual({
			framable: false,
			detail: "CSP frame-ancestors https://a.example https://b.example",
		});
		expect(verdict(null, "frame-ancestors").detail).toBe(
			"CSP frame-ancestors (empty)",
		);
	});

	test("detail is clipped", () => {
		const long = `frame-ancestors ${"https://h.example ".repeat(40)}`;
		const d = verdict(null, long).detail ?? "";
		expect(d.length).toBeLessThanOrEqual(300);
		expect(d.endsWith("…")).toBe(true);
	});
});

interface Scripted {
	status: number;
	headers?: Record<string, string>;
}

function stubFetch(
	routes: Record<string, Scripted | ((method: string) => Scripted)>,
): { fetch: EmbedFetch; calls: string[]; cancelled: number } {
	const state = { calls: [] as string[], cancelled: 0 };
	const fetch: EmbedFetch = async (url, init) => {
		state.calls.push(`${init.method} ${url}`);
		expect(init.redirect).toBe("manual");
		const route = routes[url];
		if (!route) throw new Error(`unexpected request ${url}`);
		const r = typeof route === "function" ? route(init.method) : route;
		const lower = Object.fromEntries(
			Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
		);
		const res: EmbedFetchResponse = {
			status: r.status,
			headers: { get: (n) => lower[n.toLowerCase()] ?? null },
			body: {
				cancel: async () => {
					state.cancelled++;
				},
			},
		};
		return res;
	};
	return {
		fetch,
		get calls() {
			return state.calls;
		},
		get cancelled() {
			return state.cancelled;
		},
	};
}

describe("checkEmbedUrl (stubbed network)", () => {
	const url = "https://site.example/";

	test("reads headers from a HEAD answer and discards the body", async () => {
		const net = stubFetch({
			[url]: { status: 200, headers: { "X-Frame-Options": "DENY" } },
		});
		expect(await checkEmbedUrl(url, net)).toEqual({
			url,
			framable: false,
			basis: "headers",
			detail: "X-Frame-Options: deny",
		});
		expect(net.calls).toEqual([`HEAD ${url}`]);
		expect(net.cancelled).toBe(1);
	});

	test("falls back to GET when HEAD is refused", async () => {
		const net = stubFetch({
			[url]: (m) =>
				m === "HEAD"
					? { status: 405 }
					: {
							status: 200,
							headers: { "content-security-policy": "frame-ancestors *" },
						},
		});
		expect(await checkEmbedUrl(url, net)).toMatchObject({
			framable: true,
			basis: "headers",
		});
		expect(net.calls).toEqual([`HEAD ${url}`, `GET ${url}`]);
	});

	test("ignores Report-Only CSP", async () => {
		const net = stubFetch({
			[url]: {
				status: 200,
				headers: {
					"content-security-policy-report-only": "frame-ancestors 'none'",
				},
			},
		});
		expect((await checkEmbedUrl(url, net)).framable).toBe(true);
	});

	test("follows https redirects, judging the final response", async () => {
		const net = stubFetch({
			[url]: { status: 301, headers: { location: "/home" } },
			"https://site.example/home": {
				status: 302,
				headers: { location: "https://www.site.example/" },
			},
			"https://www.site.example/": {
				status: 200,
				headers: { "x-frame-options": "sameorigin" },
			},
		});
		const result = await checkEmbedUrl(url, net);
		expect(result).toMatchObject({ url, framable: false, basis: "headers" });
	});

	test("a redirect to http is unreachable, not followed", async () => {
		const net = stubFetch({
			[url]: { status: 302, headers: { location: "http://site.example/" } },
		});
		const result = await checkEmbedUrl(url, net);
		expect(result).toMatchObject({ framable: true, basis: "unreachable" });
		expect(result.detail).toContain("non-https");
		expect(net.calls).toHaveLength(1);
	});

	test("caps redirects", async () => {
		const net = stubFetch({
			[url]: { status: 302, headers: { location: url } },
		});
		const result = await checkEmbedUrl(url, {
			fetch: net.fetch,
			maxRedirects: 3,
		});
		expect(result).toMatchObject({ basis: "unreachable" });
		expect(result.detail).toContain("3 redirects");
		expect(net.calls).toHaveLength(4);
	});

	test("a 3xx without Location is unreachable", async () => {
		const net = stubFetch({ [url]: { status: 302 } });
		expect((await checkEmbedUrl(url, net)).basis).toBe("unreachable");
	});

	test("a network error is unreachable and assumed framable", async () => {
		const result = await checkEmbedUrl(url, {
			fetch: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		expect(result).toMatchObject({ framable: true, basis: "unreachable" });
		expect(result.detail).toContain("ENOTFOUND");
	});

	test("times out through the abort signal", async () => {
		vi.useFakeTimers();
		try {
			const pending = checkEmbedUrl(url, {
				timeoutMs: 50,
				fetch: (_u, init) =>
					new Promise((_, reject) => {
						init.signal.addEventListener("abort", () =>
							reject(new Error("aborted")),
						);
					}),
			});
			await vi.advanceTimersByTimeAsync(60);
			const result = await pending;
			expect(result).toMatchObject({ basis: "unreachable" });
			expect(result.detail).toContain("50ms");
		} finally {
			vi.useRealTimers();
		}
	});

	test("never requests a non-https url in the first place", async () => {
		const net = stubFetch({});
		expect((await checkEmbedUrl("http://x.example/", net)).basis).toBe(
			"unreachable",
		);
		expect(net.calls).toEqual([]);
	});

	test("checkEmbedUrls fetches each distinct url once", async () => {
		const net = stubFetch({
			[url]: { status: 200 },
			"https://b.example/": {
				status: 200,
				headers: { "x-frame-options": "deny" },
			},
		});
		const out = await checkEmbedUrls([url, "https://b.example/", url], net);
		expect(out.size).toBe(2);
		expect(out.get("https://b.example/")?.framable).toBe(false);
		expect(net.calls).toHaveLength(2);
	});
});

describe("convert() embeds.json", () => {
	const utf8 = (s: string) => new TextEncoder().encode(s);
	const zip = (cabn: object) =>
		new ZipSource(
			zipSync({
				"cabn.json": utf8(JSON.stringify(cabn)),
				"a.md": utf8("# a\n"),
				"b.md": utf8("# b\n"),
				"c.txt": utf8("c\n"),
			}),
		);
	const config = {
		cabnConfigVersion: 1,
		previews: {
			"a.md": { kind: "url", url: "https://ok.example/" },
			"b.md": { kind: "url", url: "https://blocked.example/" },
		},
		allowedEmbedOrigins: ["https://ok.example", "https://blocked.example"],
	};
	const read = (bundle: Map<string, Uint8Array | string>) =>
		JSON.parse(bundle.get("embeds.json") as string) as EmbedIndexFile;
	const opts = { name: "t", source: "t", now: () => new Date(0) };

	test("offline by default: no fetch, every url assumed framable", async () => {
		const index = read(await convert(zip(config), opts));
		expect(index).toEqual({
			embedsVersion: 1,
			mode: "offline",
			entries: {
				"a.md": {
					url: "https://ok.example/",
					framable: true,
					basis: "offline",
				},
				"b.md": {
					url: "https://blocked.example/",
					framable: true,
					basis: "offline",
				},
			},
		});
	});

	test("with an injected fetch, records per-portal verdicts", async () => {
		const net = stubFetch({
			"https://ok.example/": { status: 200 },
			"https://blocked.example/": {
				status: 200,
				headers: { "x-frame-options": "DENY" },
			},
		});
		const index = read(
			await convert(zip(config), { ...opts, embedNetwork: net }),
		);
		expect(index.mode).toBe("network");
		expect(index.entries["a.md"]).toMatchObject({
			framable: true,
			basis: "headers",
		});
		expect(index.entries["b.md"]).toMatchObject({
			framable: false,
			detail: "X-Frame-Options: deny",
		});
		expect(index.entries["c.txt"]).toBeUndefined();
	});

	test("cabn.json embedCheck:false wins over an injected fetch", async () => {
		const fetch = vi.fn<EmbedFetch>();
		const index = read(
			await convert(zip({ ...config, embedCheck: false }), {
				...opts,
				embedNetwork: { fetch },
			}),
		);
		expect(fetch).not.toHaveBeenCalled();
		expect(index.mode).toBe("offline");
	});

	test("world.json is unchanged by the check (older engines see the same bundle)", async () => {
		const net = stubFetch({
			"https://ok.example/": { status: 200 },
			"https://blocked.example/": {
				status: 200,
				headers: { "x-frame-options": "DENY" },
			},
		});
		const offline = await convert(zip(config), opts);
		const online = await convert(zip(config), { ...opts, embedNetwork: net });
		expect(online.get("world.json")).toBe(offline.get("world.json"));
	});
});
