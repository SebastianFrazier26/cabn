import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PortalEmbed } from "../src/react/PortalEmbed.js";
import {
	canOpenPortalLink,
	openPortalLink,
	shouldMountEmbed,
} from "../src/systems/embedGuard.js";

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

	test("refuses the page's own origin even when the allowlist names it", () => {
		const own = ["https://cabn.example", "https://example.com"];
		expect(
			shouldMountEmbed(
				"https://cabn.example/x",
				own,
				true,
				"https://cabn.example",
			),
		).toBe(false);
		expect(
			shouldMountEmbed(
				"https://example.com/x",
				own,
				true,
				"https://cabn.example",
			),
		).toBe(true);
	});

	test("an opaque page origin doesn't block anything", () => {
		expect(
			shouldMountEmbed("https://example.com/page", allowed, true, "null"),
		).toBe(true);
	});
});

describe("PortalEmbed's fallback card", () => {
	function render(url: string, allowedEmbedOrigins: readonly string[]) {
		return renderToStaticMarkup(
			createElement(PortalEmbed, {
				url,
				allowedEmbedOrigins,
				worldBaseUrl: "/world/",
				active: true,
			}),
		);
	}

	test.each([
		["javascript:alert(1)", "javascript: scheme"],
		["https://evil.example/", "origin not allowlisted"],
		["http://example.com/", "non-https"],
	])("has no link for %s (%s)", (url) => {
		const html = render(url, ["https://example.com"]);
		expect(html).toContain("cabn-panel");
		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("href=");
	});

	test("an allowlisted url still embeds", () => {
		const html = render("https://example.com/", ["https://example.com"]);
		expect(html).toContain("<iframe");
	});
});

describe("canOpenPortalLink / openPortalLink", () => {
	const allowed = ["https://example.com"];

	test("allows an https url on the allowlist", () => {
		expect(canOpenPortalLink("https://example.com/about", allowed)).toBe(true);
	});

	test.each([
		["http://example.com/", "non-https"],
		["javascript:alert(1)", "javascript: scheme"],
		["data:text/html,hi", "data: scheme"],
		["https://evil.example/", "origin not allowlisted"],
		["https://example.com.evil.io/", "lookalike host"],
		["not a url", "malformed"],
	])("refuses %s (%s)", (url) => {
		expect(canOpenPortalLink(url, allowed)).toBe(false);
	});

	test("opens a new tab with noopener,noreferrer when allowed", () => {
		const calls: unknown[][] = [];
		const opened = openPortalLink("https://example.com/", allowed, (...a) =>
			calls.push(a),
		);
		expect(opened).toBe(true);
		expect(calls).toEqual([
			["https://example.com/", "_blank", "noopener,noreferrer"],
		]);
	});

	test("never calls window.open for a refused url", () => {
		const calls: unknown[][] = [];
		expect(
			openPortalLink("http://example.com/", allowed, (...a) => calls.push(a)),
		).toBe(false);
		expect(calls).toEqual([]);
	});

	test("is a no-op without a window (non-browser host)", () => {
		expect(openPortalLink("https://example.com/", allowed, undefined)).toBe(
			false,
		);
	});
});
