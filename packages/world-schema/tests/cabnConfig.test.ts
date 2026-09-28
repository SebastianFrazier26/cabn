import { describe, expect, test } from "vitest";
import {
	CABN_CONFIG_VERSION,
	CabnConfigValidationError,
	isAllowedEmbedOrigin,
	isHttpsOrigin,
	validateCabnConfig,
} from "../src/index.js";

function baseConfig() {
	return {
		cabnConfigVersion: CABN_CONFIG_VERSION,
		previews: {},
		allowedEmbedOrigins: [],
	};
}

describe("validateCabnConfig", () => {
	test("accepts an empty config", () => {
		expect(() => validateCabnConfig(baseConfig())).not.toThrow();
	});

	test("accepts an image override", () => {
		const config = {
			...baseConfig(),
			previews: { "docs/logo.png": { kind: "image", src: "art/logo.png" } },
		};
		expect(() => validateCabnConfig(config)).not.toThrow();
	});

	test("accepts a markdown override", () => {
		const config = {
			...baseConfig(),
			previews: {
				"README.md": { kind: "markdown", src: "docs/README.long.md" },
			},
		};
		expect(() => validateCabnConfig(config)).not.toThrow();
	});

	test("accepts a text override", () => {
		const config = {
			...baseConfig(),
			previews: { "NOTES.txt": { kind: "text", text: "A short blurb." } },
		};
		expect(() => validateCabnConfig(config)).not.toThrow();
	});

	test("accepts a url override whose origin is allowlisted", () => {
		const config = {
			...baseConfig(),
			allowedEmbedOrigins: ["https://example.com"],
			previews: {
				"portfolio.html": { kind: "url", url: "https://example.com/portfolio" },
			},
		};
		expect(() => validateCabnConfig(config)).not.toThrow();
	});

	test("rejects a url override whose origin isn't allowlisted", () => {
		const config = {
			...baseConfig(),
			allowedEmbedOrigins: ["https://example.com"],
			previews: {
				"portfolio.html": {
					kind: "url",
					url: "https://evil.example/portfolio",
				},
			},
		};
		expect(() => validateCabnConfig(config)).toThrow(CabnConfigValidationError);
		try {
			validateCabnConfig(config);
			expect.unreachable();
		} catch (err) {
			expect((err as CabnConfigValidationError).issues).toContain(
				"portfolio.html",
			);
		}
	});

	test("rejects a non-https url override", () => {
		const config = {
			...baseConfig(),
			allowedEmbedOrigins: ["http://example.com"],
			previews: {
				"a.html": { kind: "url", url: "http://example.com/a" },
			},
		};
		expect(() => validateCabnConfig(config)).toThrow();
	});

	test("rejects a wildcard subdomain in allowedEmbedOrigins", () => {
		const config = {
			...baseConfig(),
			allowedEmbedOrigins: ["https://*.example.com"],
		};
		expect(() => validateCabnConfig(config)).toThrow();
	});

	test("rejects an allowedEmbedOrigins entry with a path", () => {
		const config = {
			...baseConfig(),
			allowedEmbedOrigins: ["https://example.com/some/path"],
		};
		expect(() => validateCabnConfig(config)).toThrow();
	});

	test("rejects a preview key that escapes the source root", () => {
		const config = {
			...baseConfig(),
			previews: { "../../etc/passwd": { kind: "text", text: "nope" } },
		};
		expect(() => validateCabnConfig(config)).toThrow();
	});

	test("rejects an image override src that escapes the source root", () => {
		const config = {
			...baseConfig(),
			previews: { "logo.png": { kind: "image", src: "../../secrets.png" } },
		};
		expect(() => validateCabnConfig(config)).toThrow();
	});

	test("rejects an unknown top-level key (strict object)", () => {
		const config = { ...baseConfig(), extra: true };
		expect(() => validateCabnConfig(config)).toThrow();
	});

	test("rejects an unrecognized cabnConfigVersion", () => {
		const config = { ...baseConfig(), cabnConfigVersion: 2 };
		expect(() => validateCabnConfig(config)).toThrow();
	});
});

describe("isHttpsOrigin", () => {
	test("accepts a bare https origin", () => {
		expect(isHttpsOrigin("https://example.com")).toBe(true);
	});

	test("accepts an https origin with a port", () => {
		expect(isHttpsOrigin("https://example.com:8443")).toBe(true);
	});

	test("rejects http", () => {
		expect(isHttpsOrigin("http://example.com")).toBe(false);
	});

	test("rejects a trailing slash", () => {
		expect(isHttpsOrigin("https://example.com/")).toBe(false);
	});

	test("rejects a path", () => {
		expect(isHttpsOrigin("https://example.com/path")).toBe(false);
	});

	test("rejects a wildcard subdomain", () => {
		expect(isHttpsOrigin("https://*.example.com")).toBe(false);
	});

	test("rejects embedded credentials", () => {
		expect(isHttpsOrigin("https://user:pass@example.com")).toBe(false);
	});

	test("rejects garbage input", () => {
		expect(isHttpsOrigin("not a url")).toBe(false);
	});
});

describe("isAllowedEmbedOrigin", () => {
	const allowed = ["https://example.com", "https://docs.example.com"];

	test("allows an exact origin match regardless of path", () => {
		expect(isAllowedEmbedOrigin("https://example.com/some/page", allowed)).toBe(
			true,
		);
	});

	test("rejects a different subdomain", () => {
		expect(isAllowedEmbedOrigin("https://evil.example.com", allowed)).toBe(
			false,
		);
	});

	test("rejects a non-https url even if the host matches", () => {
		expect(isAllowedEmbedOrigin("http://example.com", allowed)).toBe(false);
	});

	test("rejects malformed urls", () => {
		expect(isAllowedEmbedOrigin("not a url", allowed)).toBe(false);
	});
});
