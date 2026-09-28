import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	constantTimeEqual,
	frameSrcPolicy,
	isAllowedOrigin,
	isLoopbackHost,
	PathConfinementError,
	resolveConfinedPath,
} from "../../src/serve/security.js";

describe("constantTimeEqual", () => {
	it("is true for identical strings", () => {
		expect(constantTimeEqual("abc123", "abc123")).toBe(true);
	});

	it("is false for different strings of the same length", () => {
		expect(constantTimeEqual("abc123", "abc124")).toBe(false);
	});

	it("is false for different-length strings without throwing", () => {
		expect(constantTimeEqual("short", "a-lot-longer-string")).toBe(false);
	});
});

describe("isLoopbackHost", () => {
	it("accepts 127.0.0.1:<port> with a matching port", () => {
		expect(isLoopbackHost("127.0.0.1:5178", 5178)).toBe(true);
	});

	it("accepts localhost:<port> case-insensitively", () => {
		expect(isLoopbackHost("LocalHost:5178", 5178)).toBe(true);
	});

	it("rejects a mismatched port (defeats a port-confusion bypass)", () => {
		expect(isLoopbackHost("127.0.0.1:9999", 5178)).toBe(false);
	});

	it("rejects an arbitrary domain — this is exactly what defeats DNS rebinding", () => {
		expect(isLoopbackHost("attacker.example.com:5178", 5178)).toBe(false);
	});

	it("rejects a missing Host header", () => {
		expect(isLoopbackHost(undefined, 5178)).toBe(false);
	});

	it("rejects a Host header with no port", () => {
		expect(isLoopbackHost("127.0.0.1", 5178)).toBe(false);
	});
});

describe("isAllowedOrigin", () => {
	it("allows a missing Origin header (most non-browser clients never send one)", () => {
		expect(isAllowedOrigin(undefined, 5178)).toBe(true);
	});

	it("allows a matching http://127.0.0.1:<port> origin", () => {
		expect(isAllowedOrigin("http://127.0.0.1:5178", 5178)).toBe(true);
	});

	it("allows a matching http://localhost:<port> origin", () => {
		expect(isAllowedOrigin("http://localhost:5178", 5178)).toBe(true);
	});

	it("rejects a present but mismatched origin", () => {
		expect(isAllowedOrigin("http://evil.example.com:5178", 5178)).toBe(false);
	});

	it("rejects a matching host on the wrong port", () => {
		expect(isAllowedOrigin("http://127.0.0.1:9999", 5178)).toBe(false);
	});

	it("rejects an https origin (this server is only ever plain http)", () => {
		expect(isAllowedOrigin("https://127.0.0.1:5178", 5178)).toBe(false);
	});
});

describe("resolveConfinedPath", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "cabn-confine-"));
		await writeFile(join(root, "inside.txt"), "hi");
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("resolves a plain relative path inside the root", async () => {
		const resolved = await resolveConfinedPath(root, "inside.txt");
		expect(resolved.endsWith("inside.txt")).toBe(true);
	});

	it("rejects a ../ traversal that escapes the root", async () => {
		await expect(
			resolveConfinedPath(root, "../outside.txt"),
		).rejects.toBeInstanceOf(PathConfinementError);
	});

	it("rejects an absolute path outright (path.resolve would otherwise discard the root entirely)", async () => {
		await expect(
			resolveConfinedPath(root, "/etc/passwd"),
		).rejects.toBeInstanceOf(PathConfinementError);
	});

	it("rejects a path containing a NUL byte", async () => {
		await expect(
			resolveConfinedPath(root, "inside.txt\0"),
		).rejects.toBeInstanceOf(PathConfinementError);
	});

	it("rejects a path that doesn't resolve to a real file", async () => {
		await expect(resolveConfinedPath(root, "nope.txt")).rejects.toBeInstanceOf(
			PathConfinementError,
		);
	});

	it("rejects a symlink whose real target escapes the root", async () => {
		const outside = await mkdtemp(join(tmpdir(), "cabn-confine-outside-"));
		try {
			await writeFile(join(outside, "secret.txt"), "top secret");
			await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
			await expect(
				resolveConfinedPath(root, "escape.txt"),
			).rejects.toBeInstanceOf(PathConfinementError);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});

describe("frameSrcPolicy", () => {
	it("names exactly the allowlisted origins", () => {
		expect(
			frameSrcPolicy(["https://threejs.org", "https://example.com:8443"]),
		).toBe("frame-src https://threejs.org https://example.com:8443");
	});

	it("is 'none' for an empty list", () => {
		expect(frameSrcPolicy([])).toBe("frame-src 'none'");
	});

	it("drops anything that isn't a bare https origin, so nothing can inject a directive", () => {
		expect(
			frameSrcPolicy([
				"*",
				"http://plain.example",
				"https://ok.example",
				"https://a.example; script-src *",
				"https://a.example/path",
				"'self'",
				42,
				"https://ok.example",
			]),
		).toBe("frame-src https://ok.example");
	});
});
