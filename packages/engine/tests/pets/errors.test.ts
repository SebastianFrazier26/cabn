import { describe, expect, it } from "vitest";
import {
	classifyHttpError,
	classifyThrown,
	petErrorMessage,
} from "../../src/pets/errors.js";
import { PET_PROVIDER_IDS, PET_PROVIDERS } from "../../src/pets/providers.js";

const kind = (...args: Parameters<typeof classifyHttpError>) =>
	classifyHttpError(...args).kind;

describe("classifyHttpError", () => {
	it("Anthropic: 402 billing_error and the older 400 credit-balance wording are credits; 429 is rate; 529 overloaded", () => {
		expect(
			kind("anthropic", 402, {
				type: "error",
				error: { type: "billing_error", message: "billing issue" },
			}),
		).toBe("credits");
		expect(
			kind("anthropic", 400, {
				type: "error",
				error: {
					type: "invalid_request_error",
					message:
						"Your credit balance is too low to access the Anthropic API.",
				},
			}),
		).toBe("credits");
		expect(
			kind("anthropic", 429, {
				error: { type: "rate_limit_error", message: "slow" },
			}),
		).toBe("rate");
		expect(
			kind("anthropic", 529, {
				error: { type: "overloaded_error", message: "" },
			}),
		).toBe("overloaded");
		expect(
			kind("anthropic", 401, {
				error: { type: "authentication_error", message: "invalid x-api-key" },
			}),
		).toBe("auth");
		expect(
			kind("anthropic", 400, {
				error: {
					type: "invalid_request_error",
					message: "max_tokens: too big",
				},
			}),
		).toBe("other");
	});

	it("OpenAI: insufficient_quota is credits even though it's a 429; rate_limit_exceeded is rate", () => {
		expect(
			kind("openai", 429, {
				error: {
					type: "insufficient_quota",
					code: "insufficient_quota",
					message: "You exceeded your current quota",
				},
			}),
		).toBe("credits");
		expect(
			kind("openai", 429, {
				error: {
					type: "requests",
					code: "rate_limit_exceeded",
					message: "Rate limit reached",
				},
			}),
		).toBe("rate");
		expect(
			kind("openai", 401, {
				error: { type: "invalid_request_error", code: "invalid_api_key" },
			}),
		).toBe("auth");
		expect(
			kind("openai", 404, {
				error: {
					code: "model_not_found",
					message: "The model `x` does not exist",
				},
			}),
		).toBe("model");
	});

	it("Gemini: RESOURCE_EXHAUSTED splits on the quota id (per-minute is rate, daily/billing is credits)", () => {
		const exhausted = (quotaId: string) => ({
			error: {
				code: 429,
				status: "RESOURCE_EXHAUSTED",
				message:
					"You exceeded your current quota, please check your plan and billing details.",
				details: [
					{
						"@type": "type.googleapis.com/google.rpc.QuotaFailure",
						violations: [{ quotaId }],
					},
				],
			},
		});
		expect(
			kind(
				"gemini",
				429,
				exhausted("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
			),
		).toBe("rate");
		expect(
			kind(
				"gemini",
				429,
				exhausted("GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
			),
		).toBe("credits");
		expect(
			kind("gemini", 429, {
				error: {
					code: 429,
					status: "RESOURCE_EXHAUSTED",
					message: "Resource has been exhausted",
				},
			}),
		).toBe("rate");
		expect(
			kind("gemini", 400, {
				error: {
					code: 400,
					status: "INVALID_ARGUMENT",
					message: "API key not valid. Please pass a valid API key.",
					details: [{ reason: "API_KEY_INVALID" }],
				},
			}),
		).toBe("auth");
	});

	it("DeepSeek: 402 Insufficient Balance is credits, 401 is auth", () => {
		expect(
			kind("deepseek", 402, { error: { message: "Insufficient Balance" } }),
		).toBe("credits");
		expect(
			kind("deepseek", 401, {
				error: {
					message: "Authentication Fails",
					type: "authentication_error",
				},
			}),
		).toBe("auth");
		expect(
			kind("deepseek", 429, { error: { message: "Rate Limit Reached" } }),
		).toBe("rate");
	});

	it("Qwen: Arrearage and free-tier-only are credits; Throttling is rate; invalid_api_key is auth", () => {
		expect(
			kind("qwen", 400, {
				error: {
					code: "Arrearage",
					message:
						"Access denied, please make sure your account is in good standing.",
				},
			}),
		).toBe("credits");
		expect(
			kind("qwen", 403, {
				error: {
					code: "AllocationQuota.FreeTierOnly",
					message: "The free tier of the model has been exhausted.",
				},
			}),
		).toBe("credits");
		expect(
			kind("qwen", 429, {
				error: {
					code: "Throttling",
					message: "Requests throttling triggered.",
				},
			}),
		).toBe("rate");
		expect(
			kind("qwen", 401, {
				error: {
					code: "invalid_api_key",
					message: "Incorrect API key provided.",
				},
			}),
		).toBe("auth");
	});

	it("unparseable bodies still classify by status", () => {
		expect(kind("openai", 401, null)).toBe("auth");
		expect(kind("gemini", 503, "oops")).toBe("overloaded");
		expect(kind("deepseek", 500, undefined)).toBe("other");
	});
});

describe("classifyThrown", () => {
	it("aborts are aborts; other fetch rejections are network, or local-unreachable for Ollama", () => {
		expect(
			classifyThrown("openai", new DOMException("x", "AbortError")).kind,
		).toBe("aborted");
		expect(
			classifyThrown("openai", new TypeError("Failed to fetch")).kind,
		).toBe("network");
		expect(
			classifyThrown("ollama", new TypeError("Failed to fetch")).kind,
		).toBe("local-unreachable");
	});
});

describe("petErrorMessage", () => {
	const context = { model: "m", endpoint: "https://api.example.com/v1" };

	it("out of credits speaks in the pet's voice and links the provider's billing console", () => {
		const sounds: Record<string, string> = {
			anthropic: "Meow",
			openai: "Squeak",
			gemini: "Tweet",
			ollama: "Hum",
			qwen: "Hoot",
			deepseek: "Whoosh",
		};
		for (const id of PET_PROVIDER_IDS) {
			const message = petErrorMessage(id, { kind: "credits" }, context);
			expect(message.text).toBe(
				`${sounds[id]}… it appears our communication spell has worn off. We need to add mana to`,
			);
			expect(message.link?.href).toBe(PET_PROVIDERS[id].billingUrl);
			expect(message.link?.href.startsWith("https://")).toBe(true);
		}
	});

	it("never includes anything but fixed text, the model id and the endpoint host", () => {
		for (const k of [
			"auth",
			"rate",
			"overloaded",
			"network",
			"other",
		] as const) {
			const text = petErrorMessage(
				"deepseek",
				{ kind: k, status: 401 },
				context,
			).text;
			expect(text).toMatch(/^Whoosh/);
			expect(text).not.toMatch(/sk-|key: /i);
		}
	});
});
