import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { extractBearerToken, verifyApiKey } from "../src/auth.js";

const hashOf = (s: string) => createHash("sha256").update(s).digest();

describe("extractBearerToken", () => {
	test("accepts a well-formed header", () => {
		expect(extractBearerToken("Bearer abc123")).toBe("abc123");
	});

	test.each([
		["missing header", undefined],
		["wrong scheme", "Basic abc123"],
		["lowercase scheme", "bearer abc123"],
		["empty token", "Bearer "],
		["whitespace-only token", "Bearer    "],
	])("rejects %s", (_label, header) => {
		expect(extractBearerToken(header)).toBeUndefined();
	});
});

describe("verifyApiKey", () => {
	test("matches a key against its own stored hash", () => {
		expect(verifyApiKey("good-key", [hashOf("good-key")])).toBe(true);
	});

	test("rejects a key not in the stored set", () => {
		expect(verifyApiKey("wrong-key", [hashOf("good-key")])).toBe(false);
	});

	test("matches against any of several stored hashes", () => {
		const hashes = [hashOf("a"), hashOf("b"), hashOf("c")];
		expect(verifyApiKey("b", hashes)).toBe(true);
		expect(verifyApiKey("z", hashes)).toBe(false);
	});

	test("rejects everything when no hashes are configured", () => {
		expect(verifyApiKey("anything", [])).toBe(false);
	});
});
