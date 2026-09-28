import { describe, expect, test } from "vitest";
import { shouldMountEmbed } from "../src/systems/embedGuard.js";

describe("shouldMountEmbed", () => {
	const allowed = ["https://example.com"];

	test("mounts when active and the origin is allowlisted", () => {
		expect(shouldMountEmbed("https://example.com/page", allowed, true)).toBe(
			true,
		);
	});

	test("never mounts while inactive, even with an allowlisted origin", () => {
		expect(shouldMountEmbed("https://example.com/page", allowed, false)).toBe(
			false,
		);
	});

	test("refuses an origin not on the allowlist", () => {
		expect(shouldMountEmbed("https://evil.example", allowed, true)).toBe(false);
	});

	test("refuses a non-https url even if the host matches", () => {
		expect(shouldMountEmbed("http://example.com", allowed, true)).toBe(false);
	});

	test("refuses a malformed url", () => {
		expect(shouldMountEmbed("not a url", allowed, true)).toBe(false);
	});

	test("refuses everything against an empty allowlist", () => {
		expect(shouldMountEmbed("https://example.com", [], true)).toBe(false);
	});
});
