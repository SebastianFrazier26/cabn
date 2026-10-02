import {
	EMBED_DETAIL_MAX_CHARS,
	type EmbedCheckEntry,
} from "@cabn/world-schema";

/**
 * Build-time "will this site let itself be framed?" check for url previews.
 * The engine can't answer this at runtime: a blocked cross-origin frame
 * still fires `load` (Chrome loads its own error page into it) and the host
 * page can't inspect what rendered. The response headers can answer it, so
 * the converter reads them once and records a verdict in embeds.json.
 *
 * Browser-safe on purpose (no node:* imports): the network half only ever
 * runs through a `fetch` the host injects, and convert() without one never
 * makes a request at all.
 */

export interface FramingHeaders {
	/** Raw `X-Frame-Options` value (multiple headers already comma-joined, as Headers#get does). */
	xFrameOptions: string | null;
	/** Raw enforced `Content-Security-Policy` value, comma-joined across headers. Report-Only is never enforced and must not be passed here. */
	contentSecurityPolicy: string | null;
}

export interface FramingVerdict {
	framable: boolean;
	detail?: string;
}

const ASCII_WS = /[\t\n\f\r ]+/;

/**
 * The `frame-ancestors` source lists of every enforced policy that has one.
 * Parsing follows CSP3: a header value is a comma-separated list of
 * policies, each a `;`-separated list of directives; directive names are
 * case-insensitive and only the first occurrence of a name in a policy
 * counts.
 */
export function frameAncestorsLists(csp: string): string[][] {
	const lists: string[][] = [];
	for (const policy of csp.split(",")) {
		const seen = new Set<string>();
		for (const rawDirective of policy.split(";")) {
			const tokens = rawDirective.trim().split(ASCII_WS).filter(Boolean);
			const name = tokens[0]?.toLowerCase();
			if (!name || seen.has(name)) continue;
			seen.add(name);
			if (name === "frame-ancestors") lists.push(tokens.slice(1));
		}
	}
	return lists;
}

/**
 * Whether a frame-ancestors source list lets an *arbitrary* page embed the
 * site. cabn worlds are hosted anywhere (a portfolio domain, 127.0.0.1 via
 * `cabn serve`), so only sources that match any embedder count: `*`, or a
 * bare `https:`/`http:` scheme source (CSP3 lets `http:` match https too).
 * `'none'`, `'self'`, an empty list, and explicit host lists (including
 * `*.example.com` wildcards) all mean "not us". `'none'` next to other
 * sources is ignored by browsers, which this falls out of naturally.
 */
export function sourceListAllowsAnyEmbedder(
	sources: readonly string[],
): boolean {
	return sources.some((raw) => {
		const s = raw.toLowerCase();
		return s === "*" || s === "https:" || s === "http:";
	});
}

/**
 * X-Frame-Options per the HTML spec's "check a navigation response's
 * adherence to X-Frame-Options": values are comma-split, trimmed and
 * lowercased into a set; more than one distinct value where any is
 * deny/sameorigin/allowall blocks; `deny` blocks; `sameorigin` blocks here
 * because a cabn host is never the embedded site's own origin; anything else
 * (allowall, the obsolete ALLOW-FROM, garbage) is ignored.
 */
export function xFrameOptionsBlocks(value: string): boolean {
	const set = new Set(
		value
			.split(",")
			.map((v) => v.trim().toLowerCase())
			.filter(Boolean),
	);
	const meaningful = ["deny", "sameorigin", "allowall"];
	if (set.size > 1) return meaningful.some((m) => set.has(m));
	return set.has("deny") || set.has("sameorigin");
}

function clip(text: string): string {
	return text.length > EMBED_DETAIL_MAX_CHARS
		? `${text.slice(0, EMBED_DETAIL_MAX_CHARS - 1)}…`
		: text;
}

/**
 * The verdict for one response. A CSP frame-ancestors directive, when any
 * enforced policy has one, decides alone and X-Frame-Options is ignored (as
 * browsers do); every policy carrying the directive must allow.
 */
export function evaluateFramingHeaders(
	headers: FramingHeaders,
): FramingVerdict {
	const lists = headers.contentSecurityPolicy
		? frameAncestorsLists(headers.contentSecurityPolicy)
		: [];
	if (lists.length > 0) {
		const blocking = lists.find((l) => !sourceListAllowsAnyEmbedder(l));
		if (blocking) {
			return {
				framable: false,
				detail: clip(
					`CSP frame-ancestors ${blocking.length ? blocking.join(" ") : "(empty)"}`,
				),
			};
		}
		return { framable: true };
	}
	if (headers.xFrameOptions && xFrameOptionsBlocks(headers.xFrameOptions)) {
		return {
			framable: false,
			detail: clip(
				`X-Frame-Options: ${headers.xFrameOptions.trim().toLowerCase()}`,
			),
		};
	}
	return { framable: true };
}

/** The slice of the WHATWG fetch API this needs — structural so tests pass a stub and no real request is ever made from a unit test. */
export interface EmbedFetchResponse {
	status: number;
	headers: { get(name: string): string | null };
	body?: { cancel(): Promise<void> } | null;
}
export type EmbedFetch = (
	url: string,
	init: {
		method: "HEAD" | "GET";
		redirect: "manual";
		signal: AbortSignal;
		headers: Record<string, string>;
	},
) => Promise<EmbedFetchResponse>;

export interface EmbedCheckNetwork {
	fetch: EmbedFetch;
	/** Whole-check budget per url, redirects included. */
	timeoutMs?: number;
	maxRedirects?: number;
}

export const DEFAULT_EMBED_CHECK_TIMEOUT_MS = 5000;
export const DEFAULT_EMBED_CHECK_MAX_REDIRECTS = 5;

function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

async function discardBody(res: EmbedFetchResponse): Promise<void> {
	// Only headers matter; never download the page itself.
	try {
		await res.body?.cancel();
	} catch {
		// already closed/errored — nothing to free
	}
}

/**
 * One url's verdict over the network: HEAD first, GET when HEAD isn't
 * answered properly (405/501 and other 4xx/5xx — plenty of servers only
 * implement GET or send different headers on errors), redirects followed by
 * hand so every hop is re-checked as https and the hop count is capped.
 * Never throws: anything that prevents an answer is "unreachable", which is
 * treated as framable — the engine keeps its runtime timeout fallback, so a
 * flaky network at build time can't hide a working page.
 */
export async function checkEmbedUrl(
	url: string,
	net: EmbedCheckNetwork,
): Promise<EmbedCheckEntry> {
	const timeoutMs = net.timeoutMs ?? DEFAULT_EMBED_CHECK_TIMEOUT_MS;
	const maxRedirects = net.maxRedirects ?? DEFAULT_EMBED_CHECK_MAX_REDIRECTS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const unreachable = (detail: string): EmbedCheckEntry => ({
		url,
		framable: true,
		basis: "unreachable",
		detail: clip(detail),
	});
	const request = async (target: string, method: "HEAD" | "GET") => {
		const res = await net.fetch(target, {
			method,
			redirect: "manual",
			signal: controller.signal,
			headers: { accept: "text/html,*/*;q=0.8" },
		});
		await discardBody(res);
		return res;
	};

	try {
		let target = url;
		for (let hop = 0; ; hop++) {
			if (!isHttps(target))
				return unreachable(`redirected to a non-https url (${target})`);
			let res = await request(target, "HEAD");
			if (res.status >= 400) res = await request(target, "GET");
			if (res.status >= 300 && res.status < 400) {
				const location = res.headers.get("location");
				if (!location)
					return unreachable(`HTTP ${res.status} without Location`);
				if (hop >= maxRedirects)
					return unreachable(`more than ${maxRedirects} redirects`);
				target = new URL(location, target).toString();
				continue;
			}
			const verdict = evaluateFramingHeaders({
				xFrameOptions: res.headers.get("x-frame-options"),
				contentSecurityPolicy: res.headers.get("content-security-policy"),
			});
			return {
				url,
				framable: verdict.framable,
				basis: "headers",
				...(verdict.detail !== undefined ? { detail: verdict.detail } : {}),
			};
		}
	} catch (err) {
		return unreachable(
			controller.signal.aborted
				? `no answer within ${timeoutMs}ms`
				: `request failed (${(err as Error).message ?? String(err)})`,
		);
	} finally {
		clearTimeout(timer);
	}
}

const CHECK_CONCURRENCY = 4;

/** Verdicts for a set of urls, each fetched once however many portals share it. */
export async function checkEmbedUrls(
	urls: Iterable<string>,
	net: EmbedCheckNetwork,
): Promise<Map<string, EmbedCheckEntry>> {
	const queue = [...new Set(urls)];
	const out = new Map<string, EmbedCheckEntry>();
	const worker = async () => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
			out.set(next, await checkEmbedUrl(next, net));
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, worker),
	);
	return out;
}
