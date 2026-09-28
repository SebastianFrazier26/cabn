import { describe, expect, test } from "vitest";
import { verifyApiKey } from "../src/auth.js";
import { sha256Hex } from "../src/config.js";
import { generateApiKey } from "../src/keygen.js";

describe("generateApiKey", () => {
	test("plaintext is prefixed and the hash matches it", () => {
		const { plaintext, sha256 } = generateApiKey();
		expect(plaintext).toMatch(/^cabn_/);
		expect(sha256).toBe(sha256Hex(plaintext));
	});

	test("the printed hash actually authenticates the printed key", () => {
		const { plaintext, sha256 } = generateApiKey();
		expect(verifyApiKey(plaintext, [Buffer.from(sha256, "hex")])).toBe(true);
	});

	test("two calls never collide", () => {
		const a = generateApiKey();
		const b = generateApiKey();
		expect(a.plaintext).not.toBe(b.plaintext);
	});
});
