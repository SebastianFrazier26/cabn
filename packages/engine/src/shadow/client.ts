import {
	type SearchIndexFile,
	SearchIndexFileSchema,
	type SignEntry,
	SignEntrySchema,
	type WorldChunk,
	WorldChunkSchema,
	type WorldLayerManifest,
	WorldLayerManifestSchema,
} from "@cabn/world-schema";
import type { OwnerSignSaveRequest } from "../systems/ownerSigns.js";

/**
 * HTTP client for `cabn serve --owner`'s shadow realm routes
 * (packages/cli/src/serve/ownerShadow.ts). Owner-only: reachable from
 * `@cabn/engine/owner` alone, never from the main entry.
 */
export interface OwnerShadowClientOptions {
	/** The serving page's own origin, e.g. `window.location.origin`. */
	baseUrl: string;
	/** Per-session owner token the host page was given. */
	token: string;
	fetch?: typeof fetch;
}

const OWNER_TOKEN_HEADER = "x-cabn-owner-token";
const SHADOW_ROUTE = "/owner/shadow/";

export type ShadowSaveResponse =
	| { status: 200; sha256: string }
	| { status: number; error: string; currentSha256?: string };

export interface OwnerShadowClient {
	manifest(): Promise<WorldLayerManifest>;
	chunk(clusterId: string): Promise<WorldChunk>;
	searchIndex(): Promise<SearchIndexFile>;
	save(body: {
		path: string;
		content: string;
		baseSha256: string;
	}): Promise<ShadowSaveResponse>;
	saveSign(request: OwnerSignSaveRequest): Promise<SignEntry>;
	removeSign(path: string): Promise<void>;
}

async function readJson(res: Response): Promise<unknown> {
	const text = await res.text();
	try {
		return text ? JSON.parse(text) : null;
	} catch {
		return null;
	}
}

function errorText(json: unknown, status: number): string {
	return json && typeof json === "object" && "error" in json
		? String((json as { error: unknown }).error)
		: `request failed (${status})`;
}

export function createOwnerShadowClient(
	opts: OwnerShadowClientOptions,
): OwnerShadowClient {
	const doFetch = opts.fetch ?? fetch;
	const request = (route: string, body?: unknown): Promise<Response> =>
		doFetch(`${opts.baseUrl}${route}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				[OWNER_TOKEN_HEADER]: opts.token,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error",
		});
	const get = async (route: string): Promise<unknown> => {
		const res = await request(`${SHADOW_ROUTE}${route}`);
		const json = await readJson(res);
		if (!res.ok) throw new Error(errorText(json, res.status));
		return json;
	};
	const signs = async (route: string, body: unknown): Promise<unknown> => {
		const res = await request(`/owner/signs/${route}`, body);
		const json = await readJson(res);
		if (!res.ok) throw new Error(errorText(json, res.status));
		return json;
	};
	return {
		manifest: async () => WorldLayerManifestSchema.parse(await get("manifest")),
		// Cluster ids carry `#` (annexes) and `/`; both must reach the server
		// as one encoded path segment.
		chunk: async (clusterId) =>
			WorldChunkSchema.parse(
				await get(`chunk/${encodeURIComponent(clusterId)}`),
			),
		searchIndex: async () =>
			SearchIndexFileSchema.parse(await get("search-index")),
		async save(body) {
			const res = await request(`${SHADOW_ROUTE}save`, body);
			const json = (await readJson(res)) as {
				sha256?: unknown;
				currentSha256?: unknown;
			} | null;
			if (res.ok && typeof json?.sha256 === "string")
				return { status: 200, sha256: json.sha256 };
			return {
				status: res.ok ? 500 : res.status,
				error: res.ok
					? "the server sent back no hash"
					: errorText(json, res.status),
				...(typeof json?.currentSha256 === "string"
					? { currentSha256: json.currentSha256 }
					: {}),
			};
		},
		async saveSign(req) {
			const json = await signs("save", { ...req, realm: "shadow" });
			const sign =
				json && typeof json === "object" && "sign" in json
					? SignEntrySchema.safeParse((json as { sign: unknown }).sign)
					: null;
			if (!sign?.success) throw new Error("the server sent back no sign");
			return sign.data;
		},
		async removeSign(path) {
			await signs("delete", { path, realm: "shadow" });
		},
	};
}
