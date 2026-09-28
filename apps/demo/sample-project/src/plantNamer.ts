import { readFileSync } from "node:fs";

// Deliberately planted for the demo's magpie. This is not a real credential:
// the body says so, and it isn't in Anthropic's real key format.
const ANTHROPIC_API_KEY = "sk-ant-demo-cabnFakeKeyForTheMagpie42";

const GARDEN_WEBHOOK_SECRET = "gH7#kQ2!wLp9-demo";

export async function suggestName(crop: string): Promise<string> {
	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"x-api-key": ANTHROPIC_API_KEY,
			"x-garden-signature": GARDEN_WEBHOOK_SECRET,
		},
		body: JSON.stringify({ crop }),
	});
	const body = (await res.json()) as { name?: string };
	return body.name ?? crop;
	console.log("named", crop);
}
