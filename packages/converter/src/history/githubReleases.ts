import {
	type HistoryIndexFile,
	type HistoryPackage,
	HistoryPackageSchema,
	type HistoryRelease,
	HistoryReleaseSchema,
	MAX_RELEASE_BODY_CHARS,
} from "@cabn/world-schema";
import { z } from "zod";

/**
 * GitHub releases and packages, read once at build time from the public
 * REST API. Browser-safe like embedCheck.ts: the request only ever goes
 * through a fetch the host injects, so convert() without one (apps/backend,
 * `--offline`) never touches the network. Authentication is the host's
 * business — the CLI's fetch adds GITHUB_TOKEN itself — so no token ever
 * passes through here, let alone into the bundle.
 */

export interface GithubFetchResponse {
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}

export type GithubFetch = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<GithubFetchResponse>;

export interface GithubNetwork {
	fetch: GithubFetch;
	/** Packages need an authenticated request (GitHub's packages API refuses anonymous callers); the host says whether its fetch carries a token. */
	authenticated?: boolean;
	timeoutMs?: number;
}

export interface GithubRepoRef {
	owner: string;
	name: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** github.com remotes only (https, ssh, scp-style). Anything else — including other hosts that merely contain "github.com" — is null. */
export function parseGithubRemote(url: string): GithubRepoRef | null {
	const trimmed = url.trim();
	let path: string | undefined;
	const scp = /^git@github\.com:(.+)$/.exec(trimmed);
	if (scp) path = scp[1];
	else {
		try {
			const parsed = new URL(trimmed);
			if (
				parsed.hostname !== "github.com" ||
				!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)
			)
				return null;
			path = parsed.pathname.replace(/^\//, "");
		} catch {
			return null;
		}
	}
	if (!path) return null;
	const [owner, rawName, ...rest] = path.replace(/\/$/, "").split("/");
	if (rest.length > 0 || !owner || !rawName) return null;
	const name = rawName.replace(/\.git$/, "");
	if (!NAME.test(owner) || !NAME.test(name) || name === "." || name === "..")
		return null;
	return { owner, name };
}

const ApiAssetSchema = z.object({
	name: z.string(),
	size: z.number(),
	download_count: z.number().optional(),
	browser_download_url: z.string(),
});
const ApiReleaseSchema = z.object({
	tag_name: z.string(),
	name: z.string().nullable().optional(),
	body: z.string().nullable().optional(),
	draft: z.boolean().optional(),
	prerelease: z.boolean().optional(),
	published_at: z.string().nullable().optional(),
	html_url: z.string(),
	assets: z.array(ApiAssetSchema).optional(),
});
const ApiPackageSchema = z.object({
	name: z.string(),
	package_type: z.string(),
	html_url: z.string(),
	repository: z.object({ full_name: z.string() }).nullable().optional(),
});

const API = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const PACKAGE_TYPES = ["npm", "container"] as const;
const MAX_PACKAGES = 20;

async function getJson(
	net: GithubNetwork,
	url: string,
): Promise<{ status: number; json?: unknown }> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		net.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	try {
		const res = await net.fetch(url, {
			headers: {
				accept: "application/vnd.github+json",
				"x-github-api-version": "2022-11-28",
				"user-agent": "cabn-converter",
			},
			signal: controller.signal,
		});
		if (!res.ok) return { status: res.status };
		return { status: res.status, json: await res.json() };
	} finally {
		clearTimeout(timer);
	}
}

/** Each item is re-validated against the bundle schema; one odd release is dropped, not fatal. */
function toReleases(raw: unknown, max: number): HistoryRelease[] {
	if (!Array.isArray(raw)) return [];
	const out: HistoryRelease[] = [];
	for (const item of raw) {
		if (out.length >= max) break;
		const parsed = ApiReleaseSchema.safeParse(item);
		if (!parsed.success || parsed.data.draft) continue;
		const r = parsed.data;
		const candidate = {
			tagName: r.tag_name.slice(0, 255),
			name: (r.name ?? "").slice(0, 255),
			body: (r.body ?? "").slice(0, MAX_RELEASE_BODY_CHARS),
			prerelease: r.prerelease ?? false,
			publishedAt: r.published_at ?? null,
			url: r.html_url,
			assets: (r.assets ?? []).slice(0, 50).map((a) => ({
				name: a.name.slice(0, 255),
				size: Math.max(0, Math.floor(a.size)),
				downloadCount: Math.max(0, Math.floor(a.download_count ?? 0)),
				url: a.browser_download_url,
			})),
		};
		const ok = HistoryReleaseSchema.safeParse(candidate);
		if (ok.success) out.push(ok.data);
	}
	return out;
}

async function fetchPackages(
	net: GithubNetwork,
	repo: GithubRepoRef,
): Promise<HistoryPackage[]> {
	const out: HistoryPackage[] = [];
	const fullName = `${repo.owner}/${repo.name}`.toLowerCase();
	for (const type of PACKAGE_TYPES) {
		// /users/ answers 404 for an organisation's packages.
		for (const scope of ["users", "orgs"]) {
			const res = await getJson(
				net,
				`${API}/${scope}/${encodeURIComponent(repo.owner)}/packages?package_type=${type}&per_page=100`,
			);
			if (res.status === 404) continue;
			if (!Array.isArray(res.json)) break;
			for (const item of res.json) {
				const parsed = ApiPackageSchema.safeParse(item);
				if (!parsed.success) continue;
				if (parsed.data.repository?.full_name.toLowerCase() !== fullName)
					continue;
				const ok = HistoryPackageSchema.safeParse({
					name: parsed.data.name.slice(0, 255),
					packageType: parsed.data.package_type.slice(0, 40),
					url: parsed.data.html_url,
				});
				if (ok.success && out.length < MAX_PACKAGES) out.push(ok.data);
			}
			break;
		}
	}
	return out;
}

export async function fetchGithubReleases(
	net: GithubNetwork,
	repo: GithubRepoRef,
	maxReleases: number,
): Promise<HistoryIndexFile["releases"]> {
	const base = {
		repo: {
			owner: repo.owner,
			name: repo.name,
			url: `https://github.com/${repo.owner}/${repo.name}`,
		},
	};
	try {
		const releases =
			maxReleases > 0
				? await getJson(
						net,
						`${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/releases?per_page=${Math.min(maxReleases, 100)}`,
					)
				: { status: 200, json: [] };
		if (releases.json === undefined) {
			return { source: "unavailable", ...base, items: [], packages: [] };
		}
		const packages = net.authenticated
			? await fetchPackages(net, repo).catch(() => [])
			: [];
		return {
			source: "github",
			...base,
			items: toReleases(releases.json, maxReleases),
			packages,
		};
	} catch {
		return { source: "unavailable", ...base, items: [], packages: [] };
	}
}
