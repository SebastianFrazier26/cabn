import { PET_PROVIDERS, type PetProviderId } from "./providers.js";

/**
 * Turns a failed provider call into one of a few kinds the pet can explain
 * in character. Provider error bodies are read for their machine fields
 * (type/code/status) and a few telltale phrases only — the text itself is
 * never shown, because some providers echo part of the key back in it
 * (DeepSeek's 401 names the key's last characters).
 */
export type PetErrorKind =
	| "credits"
	| "auth"
	| "rate"
	| "overloaded"
	| "model"
	| "network"
	| "local-unreachable"
	| "aborted"
	| "other";

export interface PetFailure {
	kind: PetErrorKind;
	/** HTTP status when there was a response. */
	status?: number;
}

interface ErrorFields {
	type: string;
	code: string;
	status: string;
	message: string;
	quotaIds: string[];
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

/** Pulls the fields every dialect's error envelope uses: Anthropic `{error:{type,message}}`, OpenAI-style `{error:{type,code,message}}`, Gemini `{error:{code,status,message,details}}`, DashScope's own top-level `{code,message}`. */
export function errorFields(body: unknown): ErrorFields {
	const root = record(body);
	const err = record(root.error);
	const details = Array.isArray(err.details) ? err.details : [];
	const quotaIds: string[] = [];
	for (const detail of details) {
		const violations = record(detail).violations;
		if (!Array.isArray(violations)) continue;
		for (const v of violations) quotaIds.push(str(record(v).quotaId));
	}
	return {
		type: str(err.type) || str(root.type),
		code: str(err.code) || str(root.code) || String(err.code ?? ""),
		status: str(err.status),
		message: (str(err.message) || str(root.message)).toLowerCase(),
		quotaIds,
	};
}

const QUOTA_WORDS = /\b(quota|billing|credit|balance|arrear|payment|plan)\b/;

export function classifyHttpError(
	provider: PetProviderId,
	status: number,
	body: unknown,
): PetFailure {
	const f = errorFields(body);
	const kind = ((): PetErrorKind => {
		// Checked before status: providers disagree on 400/402/403/429 for billing.
		switch (provider) {
			case "anthropic":
				if (status === 402 || f.type === "billing_error") return "credits";
				if (status === 400 && /credit balance/.test(f.message))
					return "credits";
				if (f.type === "overloaded_error" || status === 529)
					return "overloaded";
				break;
			case "openai":
			case "deepseek":
			case "ollama":
				if (f.code === "insufficient_quota" || f.type === "insufficient_quota")
					return "credits";
				if (status === 402) return "credits";
				break;
			case "gemini":
				if (f.status === "RESOURCE_EXHAUSTED" || status === 429) {
					// Free-tier per-minute limits share the "exceeded your quota"
					// wording with the daily/billing ones; only the quota id tells
					// them apart.
					if (f.quotaIds.some((id) => /PerMinute/i.test(id))) return "rate";
					if (QUOTA_WORDS.test(f.message) || f.quotaIds.length > 0)
						return "credits";
					return "rate";
				}
				if (/billing/.test(f.message)) return "credits";
				if (
					/api_key_invalid|api key not valid/.test(
						`${f.message} ${JSON.stringify(body ?? "").toLowerCase()}`,
					)
				)
					return "auth";
				break;
			case "qwen":
				if (
					/arrearage|freetieronly|allocationquota/i.test(f.code) ||
					/arrearage|good standing|free tier/.test(f.message)
				)
					return "credits";
				if (f.code === "invalid_api_key") return "auth";
				break;
		}
		if (status === 401) return "auth";
		if (status === 403) return QUOTA_WORDS.test(f.message) ? "credits" : "auth";
		if (f.type === "authentication_error" || f.type === "permission_error")
			return "auth";
		if (
			status === 404 ||
			/model.*(not found|does not exist|not exist)/.test(f.message)
		)
			return "model";
		if (status === 429) return "rate";
		if (status === 503 || status === 529 || status === 502) return "overloaded";
		return "other";
	})();
	return { kind, status };
}

/** fetch() rejects with a TypeError for DNS/offline/CORS alike; the browser hides which on purpose. */
export function classifyThrown(
	provider: PetProviderId,
	error: unknown,
): PetFailure {
	if (error instanceof DOMException && error.name === "AbortError")
		return { kind: "aborted" };
	if (
		error &&
		typeof error === "object" &&
		(error as { name?: unknown }).name === "AbortError"
	)
		return { kind: "aborted" };
	return {
		kind: PET_PROVIDERS[provider].local ? "local-unreachable" : "network",
	};
}

export interface PetErrorMessage {
	text: string;
	link?: { href: string; label: string };
}

export function petErrorMessage(
	provider: PetProviderId,
	failure: PetFailure,
	context: { model: string; endpoint: string; pageOrigin?: string },
): PetErrorMessage {
	const p = PET_PROVIDERS[provider];
	const sound = p.sound;
	switch (failure.kind) {
		case "credits":
			return {
				text: `${sound}… it appears our communication spell has worn off. We need to add mana to`,
				link: { href: p.billingUrl, label: p.billingLabel },
			};
		case "auth":
			return {
				text: `${sound}? That key doesn't open the ${p.label} gate. Check it, then paste it again in my panel. Keys live at`,
				link: { href: p.keyConsoleUrl, label: hostOf(p.keyConsoleUrl) },
			};
		case "rate":
			return {
				text: `${sound}… too many spells at once. Let's catch our breath and try again in a moment.`,
			};
		case "overloaded":
			return {
				text: `${sound}… the ${p.label} ley lines are crowded right now. Try again shortly.`,
			};
		case "model":
			return {
				text: `${sound}? ${p.label} doesn't know the model "${context.model}". Pick another one in my panel.`,
			};
		case "network":
			return {
				text: `${sound}… I can't reach ${hostOf(context.endpoint)} from here. Check your connection, or an ad blocker or firewall that might be stopping it.`,
			};
		case "local-unreachable":
			return {
				text: `${sound}… I can't hear Ollama at ${context.endpoint}. Is it running? If this page isn't served from localhost, Ollama also needs OLLAMA_ORIGINS to include ${context.pageOrigin ?? "this page's origin"}, and your browser has to allow local network access.`,
				link: {
					href: "https://docs.ollama.com/faq",
					label: "Ollama's FAQ",
				},
			};
		case "aborted":
			return { text: `${sound}. (You stopped the spell.)` };
		default:
			return {
				text: `${sound}… something fizzled in the spell${failure.status ? ` (HTTP ${failure.status})` : ""}. Try asking again?`,
			};
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
