import { describe, expect, test } from "vitest";
import { resolveRelativeUrl } from "../src/render/resolveUrl.js";

describe("resolveRelativeUrl", () => {
	test("prefixes a relative url with the base", () => {
		expect(resolveRelativeUrl("/worlds/", "sample/world.json")).toBe(
			"/worlds/sample/world.json",
		);
	});

	test("passes an absolute (root-relative) url through unchanged", () => {
		expect(resolveRelativeUrl("/worlds/", "/worlds/sample/world.json")).toBe(
			"/worlds/sample/world.json",
		);
	});

	test("handles a base with no trailing content (shelf.json at the site root)", () => {
		expect(resolveRelativeUrl("", "sample/world.json")).toBe(
			"sample/world.json",
		);
	});
});
