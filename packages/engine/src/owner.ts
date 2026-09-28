// A separate entry point (package.json's "./owner" export), like
// "./local-exec": only a `cabn serve --owner` host page imports it, so the
// owner API's wire format never exists in a hosted build.
import {
	OwnerApiError,
	type OwnerCommitRequest,
	type OwnerGitApi,
	type OwnerGitStatus,
} from "./systems/ownerApi.js";

export interface OwnerGitClientOptions {
	/** The serve page's own origin. */
	baseUrl: string;
	/** The per-session owner token the host page was given. */
	token: string;
}

export function createOwnerGitClient(opts: OwnerGitClientOptions): OwnerGitApi {
	const call = async <T>(path: string, body?: unknown): Promise<T> => {
		const res = await fetch(`${opts.baseUrl}/owner/git/${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				"x-cabn-owner-token": opts.token,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: "same-origin",
			cache: "no-store",
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

export type {
	OwnerCapability,
	OwnerCommitRequest,
	OwnerGitApi,
	OwnerGitStatus,
} from "./systems/ownerApi.js";
export { OwnerApiError } from "./systems/ownerApi.js";
