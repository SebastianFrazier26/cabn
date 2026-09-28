import { randomBytes } from "node:crypto";
import { sha256Hex } from "./config.js";

export interface GeneratedApiKey {
	plaintext: string;
	sha256: string;
}

export function generateApiKey(): GeneratedApiKey {
	const plaintext = `cabn_${randomBytes(32).toString("base64url")}`;
	return { plaintext, sha256: sha256Hex(plaintext) };
}

function main(): void {
	const { plaintext, sha256 } = generateApiKey();
	console.log(
		"New cabn backend API key — shown once, store it somewhere safe (a password manager, not this terminal's scrollback):\n",
	);
	console.log(`  ${plaintext}\n`);
	console.log(
		"Add its hash to CABN_API_KEY_SHA256 (comma-separate to allow more than one key):\n",
	);
	console.log(`  ${sha256}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
