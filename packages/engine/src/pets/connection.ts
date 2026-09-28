import { adapterFor } from "./adapters.js";
import {
	classifyHttpError,
	classifyThrown,
	type PetErrorMessage,
	petErrorMessage,
} from "./errors.js";
import { PET_PROVIDERS, type PetProviderId } from "./providers.js";
import { PET_TOOL_SPECS } from "./tools.js";

export type ConnectionResult =
	| { ok: true; reply: string; models?: string[] }
	| { ok: false; message: PetErrorMessage };

/**
 * The pet panel's "test connection": one tiny real request (so it proves
 * the key, the model id and browser reach together), or for Ollama a read
 * of its local model list.
 */
export async function testPetConnection(
	providerId: PetProviderId,
	opts: {
		apiKey: string | null;
		model: string;
		endpoint: string;
		fetch: typeof fetch;
		signal?: AbortSignal;
		pageOrigin?: string;
	},
): Promise<ConnectionResult> {
	const provider = PET_PROVIDERS[providerId];
	const context = {
		model: opts.model,
		endpoint: opts.endpoint,
		pageOrigin: opts.pageOrigin,
	};
	const failWith = (failure: Parameters<typeof petErrorMessage>[1]) => ({
		ok: false as const,
		message: petErrorMessage(providerId, failure, context),
	});
	try {
		if (provider.local) {
			const res = await opts.fetch(`${opts.endpoint}/api/tags`, {
				signal: opts.signal,
				credentials: "omit",
			});
			if (!res.ok) return failWith({ kind: "local-unreachable" });
			const json = (await res.json()) as { models?: { name?: unknown }[] };
			const models = (json.models ?? [])
				.map((m) => (typeof m.name === "string" ? m.name : ""))
				.filter(Boolean);
			return {
				ok: true,
				reply: `${provider.sound}! Ollama is awake with ${models.length} model${models.length === 1 ? "" : "s"}.`,
				models,
			};
		}
		const adapter = adapterFor(provider.dialect);
		const { url, init } = adapter.buildRequest(
			[adapter.userMessage("Reply with the single word: ready")],
			{
				provider,
				endpoint: opts.endpoint,
				model: opts.model,
				apiKey: opts.apiKey,
				system: "You are a connection test. Reply with one word.",
				tools: PET_TOOL_SPECS,
			},
		);
		const res = await opts.fetch(url, {
			...init,
			signal: opts.signal,
			credentials: "omit",
			referrerPolicy: "no-referrer",
		});
		const json: unknown = await res.json().catch(() => null);
		if (!res.ok)
			return failWith(classifyHttpError(providerId, res.status, json));
		return {
			ok: true,
			reply: `${provider.sound}! The spell connects (${opts.model}).`,
		};
	} catch (error) {
		return failWith(classifyThrown(providerId, error));
	}
}
