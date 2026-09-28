// An obviously fake key: "demo" body, not Anthropic's real sk-ant-api03 format.
const ANTHROPIC_API_KEY = "sk-ant-demo-cabnFakeKeyForTheMagpie42";

export function authHeader(): Record<string, string> {
	return { "x-api-key": ANTHROPIC_API_KEY };
}
