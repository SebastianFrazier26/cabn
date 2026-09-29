import { describe, expect, it } from "vitest";
import {
	DEFAULT_AGENT_LIMITS,
	newConversation,
	type PetAgentDeps,
	runPetTurn,
} from "../../src/pets/agentLoop.js";
import { PET_PROVIDERS, type PetProviderId } from "../../src/pets/providers.js";
import type { PetWorldAccess } from "../../src/pets/tools.js";

const FILES: Record<string, string | null> = {
	"src/server.ts":
		"const port = 3000;\nexport function start() {\n  listen(port);\n}\n",
	"README.md": "# garden\nA tiny garden app.\n",
	"assets/logo.png": null,
	"src/secret.ts": 'const token = "hunter2";\n',
};

function fakeWorld(): PetWorldAccess {
	return {
		files: () =>
			Object.keys(FILES).map((path) => ({
				path,
				bytes: FILES[path]?.length ?? 100,
				kind: FILES[path] === null ? "image" : "code",
			})),
		readText: async (path) => FILES[path] ?? null,
		search: async (query) =>
			Object.keys(FILES)
				.filter((p) => (FILES[p] ?? "").includes(query) || p.includes(query))
				.map((path) => ({ path })),
		withheld: (path) =>
			path === "src/secret.ts" ? "guarded by a magpie" : null,
	};
}

interface Recorded {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
	credentials?: RequestCredentials;
}

function scriptedFetch(responses: Array<{ status?: number; json: unknown }>) {
	const calls: Recorded[] = [];
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			url: String(input),
			headers: (init?.headers ?? {}) as Record<string, string>,
			body: JSON.parse(String(init?.body ?? "{}")),
			credentials: init?.credentials,
		});
		const next = responses.shift();
		if (!next) throw new Error("no scripted response left");
		return new Response(JSON.stringify(next.json), {
			status: next.status ?? 200,
		});
	}) as typeof fetch;
	return { fetchFn, calls };
}

function anthropicToolResults(
	call: Recorded | undefined,
): Array<Record<string, unknown>> {
	const messages = (call?.body.messages ?? []) as Array<{
		content?: Array<Record<string, unknown>>;
	}>;
	return messages[2]?.content ?? [];
}

function deps(
	provider: PetProviderId,
	fetchFn: typeof fetch,
	overrides: Partial<PetAgentDeps> = {},
): PetAgentDeps {
	let n = 0;
	return {
		fetch: fetchFn,
		provider: PET_PROVIDERS[provider],
		model: PET_PROVIDERS[provider].models[0]?.id ?? "m",
		endpoint: PET_PROVIDERS[provider].endpoints[0]?.url ?? "",
		apiKey: provider === "ollama" ? null : "test-key-not-real-0000",
		world: fakeWorld(),
		signal: new AbortController().signal,
		newProposalId: () => `p${++n}`,
		...overrides,
	};
}

describe("runPetTurn — Anthropic dialect", () => {
	it("runs tool calls locally, sends results back, and returns the final text with citations", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{
				json: {
					content: [
						{ type: "text", text: "Let me look." },
						{
							type: "tool_use",
							id: "tu1",
							name: "read_file",
							input: { path: "src/server.ts" },
						},
					],
					stop_reason: "tool_use",
				},
			},
			{
				json: {
					content: [{ type: "text", text: "Meow! It listens on port 3000." }],
					stop_reason: "end_turn",
				},
			},
		]);
		const conversation = newConversation("anthropic");
		const outcome = await runPetTurn(
			conversation,
			"What port?",
			deps("anthropic", fetchFn),
		);
		expect(outcome).toMatchObject({
			ok: true,
			text: "Meow! It listens on port 3000.",
			cited: ["src/server.ts"],
		});
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
		expect(calls[0]?.headers["anthropic-dangerous-direct-browser-access"]).toBe(
			"true",
		);
		expect(calls[0]?.headers["x-api-key"]).toBe("test-key-not-real-0000");
		expect(calls[0]?.credentials).toBe("omit");
		const second = (calls[1]?.body.messages ?? []) as Array<{
			role: string;
			content: unknown;
		}>;
		expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
		const toolResult = anthropicToolResults(calls[1])[0];
		expect(toolResult).toMatchObject({
			type: "tool_result",
			tool_use_id: "tu1",
			is_error: false,
		});
		expect(String(toolResult?.content)).toContain("listen(port)");
		// The key goes in the header only, never into the conversation.
		expect(JSON.stringify(calls.map((c) => c.body))).not.toContain(
			"test-key-not-real",
		);
		expect(conversation.history).toHaveLength(4);
	});

	it("a proposal is recorded, not applied, and needs old_text to match exactly once", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{
				json: {
					content: [
						{
							type: "tool_use",
							id: "a",
							name: "propose_edit",
							input: {
								path: "src/server.ts",
								old_text: "3000",
								new_text: "8080",
								summary: "Use port 8080",
							},
						},
						{
							type: "tool_use",
							id: "b",
							name: "propose_edit",
							input: {
								path: "src/server.ts",
								old_text: "nope",
								new_text: "x",
								summary: "bad",
							},
						},
					],
				},
			},
			{ json: { content: [{ type: "text", text: "Proposed!" }] } },
		]);
		const outcome = await runPetTurn(
			newConversation("anthropic"),
			"change port",
			deps("anthropic", fetchFn),
		);
		expect(outcome.ok).toBe(true);
		expect(outcome.proposals).toHaveLength(1);
		expect(outcome.proposals[0]).toMatchObject({
			id: "p1",
			path: "src/server.ts",
			summary: "Use port 8080",
			status: "pending",
			before: FILES["src/server.ts"],
			after: String(FILES["src/server.ts"]).replace("3000", "8080"),
		});
		const results = anthropicToolResults(calls[1]);
		expect(results[0]?.is_error).toBe(false);
		expect(String(results[0]?.content)).toContain("NOT applied");
		expect(results[1]?.is_error).toBe(true);
		expect(String(results[1]?.content)).toContain("not found");
	});

	it("withheld and binary files are refused without their content", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{
				json: {
					content: [
						{
							type: "tool_use",
							id: "a",
							name: "read_file",
							input: { path: "src/secret.ts" },
						},
						{
							type: "tool_use",
							id: "b",
							name: "read_file",
							input: { path: "assets/logo.png" },
						},
						{
							type: "tool_use",
							id: "c",
							name: "read_file",
							input: { path: "../etc/passwd" },
						},
					],
				},
			},
			{ json: { content: [{ type: "text", text: "ok" }] } },
		]);
		const outcome = await runPetTurn(
			newConversation("anthropic"),
			"q",
			deps("anthropic", fetchFn),
		);
		expect(outcome.cited).toEqual([]);
		const sent = JSON.stringify(calls[1]?.body);
		expect(sent).not.toContain("hunter2");
		expect(sent).toContain("magpie");
		expect(sent).toContain("binary");
		expect(sent).toContain("No file");
	});
});

describe("runPetTurn — OpenAI-compatible dialect", () => {
	it("parses tool_calls with string arguments and replies with role:tool messages", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{
				json: {
					choices: [
						{
							message: {
								role: "assistant",
								content: null,
								tool_calls: [
									{
										id: "c1",
										type: "function",
										function: {
											name: "search",
											arguments: '{"query":"garden"}',
										},
									},
								],
							},
						},
					],
				},
			},
			{
				json: {
					choices: [
						{ message: { role: "assistant", content: "Squeak! README.md." } },
					],
				},
			},
		]);
		const outcome = await runPetTurn(
			newConversation("openai"),
			"where is garden?",
			deps("openai", fetchFn),
		);
		expect(outcome).toMatchObject({ ok: true, text: "Squeak! README.md." });
		expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
		expect(calls[0]?.headers.authorization).toBe(
			"Bearer test-key-not-real-0000",
		);
		expect(calls[0]?.body.reasoning_effort).toBe("none");
		const messages = calls[1]?.body.messages as Array<Record<string, unknown>>;
		expect(messages.map((m) => m.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
		]);
		expect(messages[3]).toMatchObject({ tool_call_id: "c1" });
		expect(String(messages[3]?.content)).toContain("README.md");
	});

	it("DeepSeek gets reasoning_content echoed back; Qwen doesn't", async () => {
		const toolTurn = {
			json: {
				choices: [
					{
						message: {
							role: "assistant",
							content: "",
							reasoning_content: "thinking about files",
							tool_calls: [
								{
									id: "c1",
									type: "function",
									function: { name: "list_files", arguments: "{}" },
								},
							],
						},
					},
				],
			},
		};
		const done = { json: { choices: [{ message: { content: "done" } }] } };
		const ds = scriptedFetch([
			structuredClone(toolTurn),
			structuredClone(done),
		]);
		await runPetTurn(
			newConversation("deepseek"),
			"q",
			deps("deepseek", ds.fetchFn),
		);
		expect(ds.calls[0]?.url).toBe("https://api.deepseek.com/chat/completions");
		expect(JSON.stringify(ds.calls[1]?.body.messages)).toContain(
			"thinking about files",
		);
		const qw = scriptedFetch([
			structuredClone(toolTurn),
			structuredClone(done),
		]);
		await runPetTurn(newConversation("qwen"), "q", deps("qwen", qw.fetchFn));
		expect(qw.calls[0]?.url).toBe(
			"https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
		);
		expect(JSON.stringify(qw.calls[1]?.body.messages)).not.toContain(
			"thinking about files",
		);
	});

	it("Ollama goes to the local /v1 surface with no Authorization header", async () => {
		const { fetchFn, calls } = scriptedFetch([
			{ json: { choices: [{ message: { content: "Hum." } }] } },
		]);
		await runPetTurn(newConversation("ollama"), "hi", deps("ollama", fetchFn));
		expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
		expect(calls[0]?.headers.authorization).toBeUndefined();
	});
});

describe("runPetTurn — Gemini dialect", () => {
	it("echoes the model turn verbatim (thought signatures) and answers functionCalls with functionResponse", async () => {
		const modelParts = [
			{
				functionCall: { name: "read_file", args: { path: "README.md" } },
				thoughtSignature: "sig-abc",
			},
		];
		const { fetchFn, calls } = scriptedFetch([
			{
				json: {
					candidates: [{ content: { role: "model", parts: modelParts } }],
				},
			},
			{
				json: {
					candidates: [
						{
							content: {
								role: "model",
								parts: [{ text: "Tweet! A tiny garden app." }],
							},
						},
					],
				},
			},
		]);
		const outcome = await runPetTurn(
			newConversation("gemini"),
			"what is this?",
			deps("gemini", fetchFn),
		);
		expect(outcome).toMatchObject({
			ok: true,
			text: "Tweet! A tiny garden app.",
			cited: ["README.md"],
		});
		expect(calls[0]?.url).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
		);
		expect(calls[0]?.url).not.toContain("key=");
		expect(calls[0]?.headers["x-goog-api-key"]).toBe("test-key-not-real-0000");
		const contents = calls[1]?.body.contents as Array<{
			role: string;
			parts: unknown[];
		}>;
		expect(contents[1]).toEqual({ role: "model", parts: modelParts });
		expect(contents[2]?.parts[0]).toMatchObject({
			functionResponse: { name: "read_file" },
		});
	});
});

describe("runPetTurn — limits, errors and stopping", () => {
	it("stops after maxToolRounds, tells the model on the last round, and leaves a valid conversation", async () => {
		const toolTurn = () => ({
			json: {
				content: [
					{
						type: "tool_use",
						id: `t${Math.random()}`,
						name: "list_files",
						input: {},
					},
				],
			},
		});
		const { fetchFn, calls } = scriptedFetch([
			toolTurn(),
			toolTurn(),
			toolTurn(),
		]);
		const conversation = newConversation("anthropic");
		const outcome = await runPetTurn(conversation, "loop forever", {
			...deps("anthropic", fetchFn),
			limits: { ...DEFAULT_AGENT_LIMITS, maxToolRounds: 2 },
		});
		expect(outcome).toMatchObject({ ok: true, stoppedEarly: "rounds" });
		expect(calls).toHaveLength(3);
		expect(JSON.stringify(calls[2]?.body)).toContain(
			"Tool limit for this question reached",
		);
		const roles = conversation.history.map((m) => (m as { role: string }).role);
		expect(roles.at(-1)).toBe("assistant");
		expect(roles.at(-2)).toBe("user");
	});

	it("caps file text per read and stops handing out content once the context budget is spent", async () => {
		const big = "x".repeat(50_000);
		const world = fakeWorld();
		world.readText = async () => big;
		const { fetchFn, calls } = scriptedFetch([
			{
				json: {
					content: [
						{
							type: "tool_use",
							id: "a",
							name: "read_file",
							input: { path: "README.md" },
						},
						{
							type: "tool_use",
							id: "b",
							name: "read_file",
							input: { path: "src/server.ts" },
						},
					],
				},
			},
			{ json: { content: [{ type: "text", text: "ok" }] } },
		]);
		await runPetTurn(newConversation("anthropic"), "q", {
			...deps("anthropic", fetchFn, { world }),
			limits: {
				...DEFAULT_AGENT_LIMITS,
				maxContextChars: 20_000,
				tools: { ...DEFAULT_AGENT_LIMITS.tools, maxFileChars: 10_000 },
			},
		});
		const results = anthropicToolResults(calls[1]);
		const first = JSON.parse(String(results[0]?.content));
		expect(first.truncated).toBe(true);
		expect(first.content).toHaveLength(10_000);
		expect(String(results[1]?.content)).toContain("Context budget");
		expect(results[1]?.is_error).toBe(true);
	});

	it("an HTTP error is classified and the turn is rolled back", async () => {
		const { fetchFn } = scriptedFetch([
			{
				status: 429,
				json: { error: { code: "insufficient_quota", message: "quota" } },
			},
		]);
		const conversation = newConversation("openai");
		const outcome = await runPetTurn(
			conversation,
			"q",
			deps("openai", fetchFn),
		);
		expect(outcome).toMatchObject({
			ok: false,
			failure: { kind: "credits", status: 429 },
		});
		expect(conversation.history).toEqual([]);
	});

	it("the stop button aborts the in-flight request and rolls back", async () => {
		const controller = new AbortController();
		const fetchFn = ((_: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new DOMException("aborted", "AbortError")),
				);
			})) as typeof fetch;
		const conversation = newConversation("anthropic");
		const pending = runPetTurn(conversation, "q", {
			...deps("anthropic", fetchFn),
			signal: controller.signal,
		});
		controller.abort();
		expect(await pending).toMatchObject({
			ok: false,
			failure: { kind: "aborted" },
		});
		expect(conversation.history).toEqual([]);
	});

	it("a network failure is 'network' for cloud providers", async () => {
		const fetchFn = (async () => {
			throw new TypeError("Failed to fetch");
		}) as typeof fetch;
		const outcome = await runPetTurn(
			newConversation("gemini"),
			"q",
			deps("gemini", fetchFn),
		);
		expect(outcome).toMatchObject({ ok: false, failure: { kind: "network" } });
	});
});
