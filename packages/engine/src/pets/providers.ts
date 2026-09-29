/**
 * Every AI provider a pet can speak for, in one typed table. Researched
 * 2026-09-28 (model ids from each provider's model docs; CORS by preflight
 * and an unauthenticated POST from a foreign https Origin — all five cloud
 * APIs answered with Access-Control-Allow-Origin, including on their 401s,
 * so each is called straight from the player's browser). Model ids go stale:
 * re-check them when a provider ships a new family.
 */

export const PET_PROVIDER_IDS = [
	"anthropic",
	"openai",
	"gemini",
	"ollama",
	"qwen",
	"deepseek",
] as const;
export type PetProviderId = (typeof PET_PROVIDER_IDS)[number];

export type PetSpecies = "cat" | "ferret" | "bird" | "llama" | "owl" | "whale";

/** Which request/response shape the provider speaks — see pets/adapters.ts. */
export type PetDialect = "anthropic" | "openai-chat" | "gemini";

export interface PetModelOption {
	id: string;
	label: string;
}

export interface PetEndpointOption {
	id: string;
	label: string;
	url: string;
}

export interface PetProviderConfig {
	id: PetProviderId;
	label: string;
	species: PetSpecies;
	/** What the pet calls itself in the chat header. */
	petName: string;
	/** The in-character interjection its messages open with. */
	sound: string;
	dialect: PetDialect;
	needsKey: boolean;
	/** First entry is the default; Ollama's is also editable (any local URL). */
	endpoints: readonly PetEndpointOption[];
	endpointEditable: boolean;
	/** First entry is the default. Ollama's list is replaced by the local model list after a connection test. */
	models: readonly PetModelOption[];
	modelEditable: boolean;
	/** Where the player gets a key. */
	keyConsoleUrl: string;
	/** Where "add mana" sends the player when the account is out of credits. */
	billingUrl: string;
	billingLabel: string;
	/** Provider-specific request fields merged into every openai-chat body. */
	extraBody?: Readonly<Record<string, unknown>>;
	/** DeepSeek's thinking mode 400s unless every assistant turn's `reasoning_content` is sent back once tools are in play. */
	echoReasoning?: boolean;
	/** "Hum" pets explain Ollama's local-only reach instead of a billing link. */
	local?: boolean;
	/** Tailwind-free accent for the panel chrome (the pet's own palette colour). */
	accent: string;
}

export const PET_PROVIDERS: Readonly<Record<PetProviderId, PetProviderConfig>> =
	{
		anthropic: {
			id: "anthropic",
			label: "Claude (Anthropic)",
			species: "cat",
			petName: "Clementine the cat",
			sound: "Meow",
			dialect: "anthropic",
			needsKey: true,
			endpoints: [
				{
					id: "default",
					label: "api.anthropic.com",
					url: "https://api.anthropic.com",
				},
			],
			endpointEditable: false,
			models: [
				{ id: "claude-sonnet-5", label: "Claude Sonnet 5" },
				{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
				{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
				{ id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
			],
			modelEditable: false,
			keyConsoleUrl: "https://platform.claude.com/settings/keys",
			billingUrl: "https://platform.claude.com/settings/billing",
			billingLabel: "the Claude Console",
			accent: "#d27846",
		},
		openai: {
			id: "openai",
			label: "OpenAI",
			species: "ferret",
			petName: "Onyx the ferret",
			sound: "Squeak",
			dialect: "openai-chat",
			needsKey: true,
			endpoints: [
				{
					id: "default",
					label: "api.openai.com",
					url: "https://api.openai.com/v1",
				},
			],
			endpointEditable: false,
			models: [
				{ id: "gpt-6-sol", label: "GPT-6 Sol" },
				{ id: "gpt-6-astra", label: "GPT-6 Astra" },
				{ id: "gpt-6-luna", label: "GPT-6 Luna" },
			],
			modelEditable: false,
			keyConsoleUrl: "https://platform.openai.com/api-keys",
			billingUrl:
				"https://platform.openai.com/settings/organization/billing/overview",
			billingLabel: "the OpenAI billing page",
			// GPT-6 models only accept function calling on Chat Completions with
			// reasoning off (the Responses API would keep it, at the cost of a
			// fourth dialect).
			extraBody: { reasoning_effort: "none" },
			accent: "#646c78",
		},
		gemini: {
			id: "gemini",
			label: "Gemini (Google)",
			species: "bird",
			petName: "Gem the bluebird",
			sound: "Tweet",
			dialect: "gemini",
			needsKey: true,
			endpoints: [
				{
					id: "default",
					label: "generativelanguage.googleapis.com",
					url: "https://generativelanguage.googleapis.com/v1beta",
				},
			],
			endpointEditable: false,
			models: [
				{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
				{ id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
				{ id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
			],
			modelEditable: false,
			keyConsoleUrl: "https://aistudio.google.com/apikey",
			billingUrl: "https://aistudio.google.com/billing",
			billingLabel: "Google AI Studio billing",
			accent: "#5aa0eb",
		},
		ollama: {
			id: "ollama",
			label: "Ollama (local)",
			species: "llama",
			petName: "Lulu the llama",
			sound: "Hum",
			dialect: "openai-chat",
			needsKey: false,
			endpoints: [
				{
					id: "default",
					label: "localhost:11434",
					url: "http://localhost:11434",
				},
			],
			endpointEditable: true,
			models: [{ id: "llama3.2", label: "llama3.2" }],
			modelEditable: true,
			keyConsoleUrl: "https://ollama.com/download",
			billingUrl: "https://ollama.com/download",
			billingLabel: "your Ollama install",
			local: true,
			accent: "#efe0b3",
		},
		qwen: {
			id: "qwen",
			label: "Qwen (Alibaba Model Studio)",
			species: "owl",
			petName: "Quill the owl",
			sound: "Hoot",
			dialect: "openai-chat",
			needsKey: true,
			// Keys are per region; the player picks theirs.
			endpoints: [
				{
					id: "intl",
					label: "International (Singapore)",
					url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
				},
				{
					id: "us",
					label: "US (Virginia)",
					url: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
				},
				{
					id: "cn",
					label: "China (Beijing)",
					url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				},
			],
			endpointEditable: false,
			models: [
				{ id: "qwen3.7-plus", label: "Qwen3.7 Plus" },
				{ id: "qwen3.8-max", label: "Qwen3.8 Max" },
				{ id: "qwen3.8-flash", label: "Qwen3.8 Flash" },
			],
			modelEditable: false,
			keyConsoleUrl: "https://modelstudio.console.alibabacloud.com/",
			billingUrl: "https://billing-cost.console.alibabacloud.com/",
			billingLabel: "Alibaba Cloud Expenses and Costs",
			accent: "#b27cd6",
		},
		deepseek: {
			id: "deepseek",
			label: "DeepSeek",
			species: "whale",
			petName: "Dew the whale",
			sound: "Whoosh",
			dialect: "openai-chat",
			needsKey: true,
			endpoints: [
				{
					id: "default",
					label: "api.deepseek.com",
					url: "https://api.deepseek.com",
				},
			],
			endpointEditable: false,
			models: [
				{ id: "deepseek-flash", label: "DeepSeek Flash" },
				{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
			],
			modelEditable: false,
			keyConsoleUrl: "https://platform.deepseek.com/api_keys",
			billingUrl: "https://platform.deepseek.com/top_up",
			billingLabel: "the DeepSeek top-up page",
			echoReasoning: true,
			accent: "#3062aa",
		},
	};

export function isPetProviderId(value: unknown): value is PetProviderId {
	return (
		typeof value === "string" &&
		(PET_PROVIDER_IDS as readonly string[]).includes(value)
	);
}

export function defaultModel(provider: PetProviderId): string {
	return PET_PROVIDERS[provider].models[0]?.id ?? "";
}

export function defaultEndpoint(provider: PetProviderId): string {
	return PET_PROVIDERS[provider].endpoints[0]?.url ?? "";
}
