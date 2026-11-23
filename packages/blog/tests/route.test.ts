import { describe, expect, it } from "vitest";
import { indexHref, parseBlogRoute, postHref } from "../src/route.js";

describe("parseBlogRoute", () => {
	it.each(["/blog", "/blog/"])("reads %s as the index", (path) => {
		expect(parseBlogRoute(path)).toEqual({ kind: "index" });
	});

	it.each(["/blog/fan-sentiment", "/blog/fan-sentiment/"])(
		"reads %s as a post",
		(path) => {
			expect(parseBlogRoute(path)).toEqual({
				kind: "post",
				slug: "fan-sentiment",
			});
		},
	);

	it.each(["/", "/play", "/blogs", "/blogging/x", "/a/blog", ""])(
		"returns null for %j",
		(path) => {
			expect(parseBlogRoute(path)).toBeNull();
		},
	);

	// Inside the blog but naming nothing valid: the caller shows not-found
	// rather than falling through to some other page.
	it.each(["/blog/Bad_Slug", "/blog/a/b", "/blog/feed.xml", "/blog//"])(
		"reads %s as a missing post",
		(path) => {
			expect(parseBlogRoute(path)).toEqual({ kind: "post", slug: "" });
		},
	);

	it("honours a custom base path", () => {
		expect(parseBlogRoute("/writing/notes/x", "/writing/notes")).toEqual({
			kind: "post",
			slug: "x",
		});
		expect(parseBlogRoute("/blog/x", "/writing")).toBeNull();
	});
});

describe("hrefs", () => {
	it("end in a slash so they match the built directories", () => {
		expect(indexHref("/blog")).toBe("/blog/");
		expect(postHref("/blog", "hello")).toBe("/blog/hello/");
	});
});
