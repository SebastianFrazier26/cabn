import { SignEntrySchema } from "@cabn/world-schema";
import type {
	OwnerSignSaveRequest,
	OwnerSignsApi,
} from "./systems/ownerSigns.js";

/**
 * `@cabn/engine/owner` — the client for `cabn serve`'s loopback owner API.
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
