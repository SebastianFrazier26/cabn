import { SignEntrySchema } from "@cabn/world-schema";
import {
	OwnerApiError,
	type OwnerCommitRequest,
	type OwnerGitApi,
	type OwnerGitStatus,
} from "./systems/ownerApi.js";
import type {
	OwnerSignSaveRequest,
	OwnerSignsApi,
} from "./systems/ownerSigns.js";

/**
 * `@cabn/engine/owner` — the clients for `cabn serve --owner`'s loopback
 * owner API: signs (`/owner/signs/*`), git (`/owner/git/*`) and the shadow
 * realm (`/owner/shadow/*`, as a world layer), one token.
 * A separate subpath (like ./local-exec) so only the local host page ever
 * bundles it: hosted builds and the demo import the main entry, which has
 * no reference to this module or to the owner token it carries.
 */
export interface ServeOwnerSignsOptions {
	/** The serving page's own origin, e.g. `window.location.origin`. */
	baseUrl: string;
	/** Per-session owner token the host page was given (never the URL's exec token). */
	token: string;
}

export const OWNER_TOKEN_HEADER = "x-cabn-owner-token";

async function post(
	opts: ServeOwnerSignsOptions,
	route: string,
	body: unknown,
): Promise<unknown> {
	const res = await fetch(`${opts.baseUrl}${route}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			[OWNER_TOKEN_HEADER]: opts.token,
		},
		body: JSON.stringify(body),
		cache: "no-store",
		credentials: "same-origin",
		redirect: "error",
	});
	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// Non-JSON (a proxy page, a plain-text 403) falls through to the status message.
	}
	if (!res.ok) {
		const message =
			json && typeof json === "object" && "error" in json
				? String((json as { error: unknown }).error)
				: `save failed (${res.status})`;
		throw new Error(message);
	}
	return json;
}

export function createServeOwnerSigns(
	opts: ServeOwnerSignsOptions,
): OwnerSignsApi {
	return {
		async save(request: OwnerSignSaveRequest) {
			const json = await post(opts, "/owner/signs/save", request);
			const sign =
				json && typeof json === "object" && "sign" in json
					? SignEntrySchema.safeParse((json as { sign: unknown }).sign)
					: null;
			if (!sign?.success) throw new Error("the server sent back no sign");
			return sign.data;
		},
		async remove(path: string) {
			await post(opts, "/owner/signs/delete", { path });
		},
	};
}

/** Same options as the signs client: one origin, one owner token for both route groups. */
export type OwnerGitClientOptions = ServeOwnerSignsOptions;

export function createOwnerGitClient(opts: OwnerGitClientOptions): OwnerGitApi {
	const call = async <T>(path: string, body?: unknown): Promise<T> => {
		const res = await fetch(`${opts.baseUrl}/owner/git/${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				[OWNER_TOKEN_HEADER]: opts.token,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: "same-origin",
			cache: "no-store",
			redirect: "error",
		});
		const json = (await res.json().catch(() => ({}))) as {
			error?: string;
			needsAuthor?: boolean;
		};
		if (!res.ok)
			throw new OwnerApiError(
				res.status,
				json.error ?? `request failed (${res.status})`,
				json.needsAuthor === true,
			);
		return json as T;
	};
	return {
		status: () => call<OwnerGitStatus>("status"),
		commit: (request: OwnerCommitRequest) => call("commit", request),
		createBranch: (request) => call("branch", request),
		checkout: (request) => call("checkout", request),
	};
}

export { SHADOW_TEXTURES, SUDO_ICON_PATH } from "./shadow/assets.js";
// The shadow realm (hidden files) — owner-only, so reachable from this
// entry alone; the main entry has only the neutral world-layer seam.
export {
	createOwnerShadowClient,
	type OwnerShadowClientOptions,
} from "./shadow/client.js";
export { createShadowLayer, SHADOW_LAYER_ID } from "./shadow/provider.js";
export { NETHER_SKIN, SHADOW_SKIN } from "./shadow/skin.js";
export { CRIMSON_TOKENS } from "./shadow/tokens.js";
export type {
	OwnerCapability,
	OwnerCommitRequest,
	OwnerGitApi,
	OwnerGitStatus,
} from "./systems/ownerApi.js";
export { OwnerApiError } from "./systems/ownerApi.js";
export type { WorldLayerProvider } from "./systems/worldLayer.js";
