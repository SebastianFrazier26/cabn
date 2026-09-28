import type { PetDialect, PetProviderConfig } from "./providers.js";

/**
 * Plain-fetch request builders and response parsers for the three wire
 * dialects (no provider SDKs: each would add a dependency, and several
 * refuse to run in a browser without a "dangerously" flag anyway). Each
 * adapter keeps the conversation in its provider's own message format, so
 * whatever the provider needs echoed back verbatim — Gemini 3's thought
 * signatures on function calls, DeepSeek's reasoning_content — survives
 * untouched from one round to the next.
 */

export interface PetToolSpec {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
		additionalProperties?: boolean;
	};
}

export interface PetToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface PetToolResult {
	id: string;
	name: string;
	content: string;
	isError: boolean;
}

export interface ParsedTurn {
	text: string;
	toolCalls: PetToolCall[];
	/** The assistant turn exactly as the provider sent it, for appendAssistant. */
	native: unknown;
}

export interface RequestContext {
	provider: PetProviderConfig;
	endpoint: string;
	model: string;
	/** Null only for key-less providers (Ollama). */
	apiKey: string | null;
	system: string;
	tools: readonly PetToolSpec[];
}

export interface ChatAdapter {
	buildRequest(
		history: readonly unknown[],
		ctx: RequestContext,
	): { url: string; init: RequestInit };
	parseResponse(json: unknown): ParsedTurn;
	userMessage(text: string): unknown;
	assistantMessage(turn: ParsedTurn): unknown;
	/** A plain-text assistant turn, for closing a conversation cut off mid-tool-call. */
	assistantText(text: string): unknown;
	toolResultMessages(results: readonly PetToolResult[]): unknown[];
}

const MAX_OUTPUT_TOKENS = 2048;

function rec(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function arr(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function parseArgs(raw: unknown): Record<string, unknown> {
	if (typeof raw === "string") {
		try {
			return rec(JSON.parse(raw));
		} catch {
			return {};
		}
	}
	return rec(raw);
}

let generatedIds = 0;
function freshId(prefix: string): string {
	generatedIds += 1;
	return `${prefix}_${generatedIds}`;
}

const anthropic: ChatAdapter = {
	buildRequest(history, ctx) {
		return {
			url: `${ctx.endpoint}/v1/messages`,
			init: {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-api-key": ctx.apiKey ?? "",
					"anthropic-version": "2023-06-01",
					// Required for any call from a browser page; the key is the
					// player's own, entered into this page, so exposing it to this
					// page is the point rather than the risk the header warns about.
					"anthropic-dangerous-direct-browser-access": "true",
				},
				body: JSON.stringify({
					model: ctx.model,
					max_tokens: MAX_OUTPUT_TOKENS,
					system: ctx.system,
					messages: history,
					tools: ctx.tools.map((t) => ({
						name: t.name,
						description: t.description,
						input_schema: t.parameters,
					})),
				}),
			},
		};
	},
	parseResponse(json) {
		const content = arr(rec(json).content);
		let text = "";
		const toolCalls: PetToolCall[] = [];
		for (const block of content) {
			const b = rec(block);
			if (b.type === "text") text += String(b.text ?? "");
			if (b.type === "tool_use")
				toolCalls.push({
					id: String(b.id ?? freshId("toolu")),
					name: String(b.name ?? ""),
					args: rec(b.input),
				});
		}
		return { text, toolCalls, native: content };
	},
	userMessage: (text) => ({ role: "user", content: text }),
	assistantMessage: (turn) => ({ role: "assistant", content: turn.native }),
	assistantText: (text) => ({ role: "assistant", content: text }),
	toolResultMessages: (results) => [
		{
			role: "user",
			content: results.map((r) => ({
				type: "tool_result",
				tool_use_id: r.id,
				content: r.content,
				is_error: r.isError,
			})),
		},
	],
};

const openaiChat: ChatAdapter = {
	buildRequest(history, ctx) {
		const headers: Record<string, string> = {
			"content-type": "application/json",
		};
		if (ctx.apiKey) headers.authorization = `Bearer ${ctx.apiKey}`;
		// Ollama's OpenAI-compatible surface lives under /v1 of the address the
		// player types; the cloud endpoints in the table already end in /v1.
		const base = ctx.provider.local ? `${ctx.endpoint}/v1` : ctx.endpoint;
		return {
			url: `${base}/chat/completions`,
			init: {
				method: "POST",
				headers,
				body: JSON.stringify({
					...ctx.provider.extraBody,
					model: ctx.model,
					messages: [
						{ role: "system", content: ctx.system },
						...prepareOpenAiHistory(
							history,
							ctx.provider.echoReasoning === true,
						),
					],
					tools: ctx.tools.map((t) => ({
						type: "function",
						function: {
							name: t.name,
							description: t.description,
							parameters: t.parameters,
						},
					})),
				}),
			},
		};
	},
	parseResponse(json) {
		const message = rec(rec(arr(rec(json).choices)[0]).message);
		const toolCalls: PetToolCall[] = arr(message.tool_calls).map((call) => {
			const c = rec(call);
			const fn = rec(c.function);
			return {
				id: String(c.id ?? freshId("call")),
				name: String(fn.name ?? ""),
				args: parseArgs(fn.arguments),
			};
		});
		// Echo back exactly what's needed; the ids are filled in so a provider
		// that omitted them still gets matching tool_call_ids.
		const native: Record<string, unknown> = {
			role: "assistant",
			content: typeof message.content === "string" ? message.content : "",
		};
		if (toolCalls.length > 0)
			native.tool_calls = toolCalls.map((call) => ({
				id: call.id,
				type: "function",
				function: { name: call.name, arguments: JSON.stringify(call.args) },
			}));
		if (typeof message.reasoning_content === "string")
			native.reasoning_content = message.reasoning_content;
		return {
			text: typeof message.content === "string" ? message.content : "",
			toolCalls,
			native,
		};
	},
	userMessage: (text) => ({ role: "user", content: text }),
	assistantMessage: (turn) => turn.native,
	assistantText: (text) => ({ role: "assistant", content: text }),
	toolResultMessages: (results) =>
		results.map((r) => ({
			role: "tool",
			tool_call_id: r.id,
			content: r.content,
		})),
};

/** Strips reasoning_content from echoed turns for providers that don't ask for it back (some reject unknown message fields). */
export function prepareOpenAiHistory(
	history: readonly unknown[],
	echoReasoning: boolean,
): unknown[] {
	if (echoReasoning) return [...history];
	return history.map((m) => {
		const msg = rec(m);
		if (!("reasoning_content" in msg)) return m;
		const { reasoning_content: _dropped, ...rest } = msg;
		return rest;
	});
}

const gemini: ChatAdapter = {
	buildRequest(history, ctx) {
		return {
			url: `${ctx.endpoint}/models/${encodeURIComponent(ctx.model)}:generateContent`,
			init: {
				method: "POST",
				headers: {
					"content-type": "application/json",
					// Header, not the documented ?key= query form: a key in a URL
					// ends up in history, proxies and error reports.
					"x-goog-api-key": ctx.apiKey ?? "",
				},
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: ctx.system }] },
					contents: history,
					tools: [
						{
							functionDeclarations: ctx.tools.map((t) => ({
								name: t.name,
								description: t.description,
								parameters: t.parameters,
							})),
						},
					],
					generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
				}),
			},
		};
	},
	parseResponse(json) {
		const content = rec(rec(arr(rec(json).candidates)[0]).content);
		let text = "";
		const toolCalls: PetToolCall[] = [];
		for (const part of arr(content.parts)) {
			const p = rec(part);
			if (typeof p.text === "string" && p.thought !== true) text += p.text;
			if (p.functionCall) {
				const fc = rec(p.functionCall);
				toolCalls.push({
					id: String(fc.id ?? freshId("fc")),
					name: String(fc.name ?? ""),
					args: rec(fc.args),
				});
			}
		}
		return {
			text,
			toolCalls,
			native: { role: "model", parts: arr(content.parts) },
		};
	},
	userMessage: (text) => ({ role: "user", parts: [{ text }] }),
	assistantMessage: (turn) => turn.native,
	assistantText: (text) => ({ role: "model", parts: [{ text }] }),
	toolResultMessages: (results) => [
		{
			role: "user",
			parts: results.map((r) => ({
				functionResponse: {
					name: r.name,
					response: r.isError ? { error: r.content } : { result: r.content },
				},
			})),
		},
	],
};

const ADAPTERS: Record<PetDialect, ChatAdapter> = {
	anthropic,
	"openai-chat": openaiChat,
	gemini,
};

export function adapterFor(dialect: PetDialect): ChatAdapter {
	return ADAPTERS[dialect];
}
