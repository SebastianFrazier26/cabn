import { describe, expect, it } from "vitest";
import {
	BlogConfigError,
	createBlog,
	definePost,
	type PostInput,
} from "../src/post.js";

const load = async () => ({ default: () => null });

function post(overrides: Partial<PostInput> = {}): PostInput {
	return definePost({
		slug: "hello",
		title: "Hello",
		date: "2026-11-21",
		summary: "A first post.",
		load,
		...overrides,
	});
}

function site(posts: PostInput[], extra: Record<string, unknown> = {}) {
	return createBlog({
		title: "Notes",
		description: "Write-ups.",
		siteUrl: "https://example.com",
		posts,
		...extra,
	});
}

function problems(fn: () => unknown): string[] {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(BlogConfigError);
		return (error as BlogConfigError).problems;
	}
	throw new Error("expected a BlogConfigError");
}

describe("createBlog", () => {
	it("applies defaults", () => {
		const blog = site([post()]);
		expect(blog.basePath).toBe("/blog");
		expect(blog.posts).toHaveLength(1);
		expect(blog.posts[0]).toMatchObject({
			slug: "hello",
			layout: "standard",
			draft: false,
		});
	});

	it("sorts newest first, then by slug", () => {
		const blog = site([
			post({ slug: "b", date: "2026-01-01" }),
			post({ slug: "c", date: "2026-03-01" }),
			post({ slug: "a", date: "2026-01-01" }),
		]);
		expect(blog.posts.map((p) => p.slug)).toEqual(["c", "a", "b"]);
	});

	it("keeps drafts out of posts but findable", () => {
		const blog = site([post(), post({ slug: "wip", draft: true })]);
		expect(blog.posts.map((p) => p.slug)).toEqual(["hello"]);
		expect(blog.drafts.map((p) => p.slug)).toEqual(["wip"]);
		expect(blog.find("wip")?.draft).toBe(true);
		expect(blog.find("nope")).toBeUndefined();
	});

	it("strips a trailing slash from siteUrl and basePath", () => {
		const blog = site([post()], {
			siteUrl: "https://example.com/",
			basePath: "/writing/",
		});
		expect(blog.siteUrl).toBe("https://example.com");
		expect(blog.basePath).toBe("/writing");
	});

	it.each([
		["Hello", "slug"],
		["a--b", "slug"],
		["-a", "slug"],
		["a/b", "slug"],
		["", "slug"],
	])("rejects slug %j", (slug, word) => {
		expect(problems(() => site([post({ slug })]))[0]).toContain(word);
	});

	it.each(["2026-13-01", "2026-02-30", "26-01-01", "2026-1-1", "yesterday"])(
		"rejects date %j",
		(date) => {
			expect(problems(() => site([post({ date })]))[0]).toContain("date");
		},
	);

	it("rejects an invalid updated date", () => {
		expect(
			problems(() => site([post({ updated: "2026-02-31" })]))[0],
		).toContain("updated");
	});

	it("rejects blank title and summary", () => {
		const found = problems(() => site([post({ title: " ", summary: "" })]));
		expect(found).toHaveLength(2);
	});

	it("rejects an unknown layout", () => {
		expect(
			problems(() => site([post({ layout: "wide" as "bare" })]))[0],
		).toContain("layout");
	});

	it.each(["javascript:alert(1)", "//evil.example/x.png", "x.png", "http://a/b.png"])(
		"rejects image %j",
		(image) => {
			expect(problems(() => site([post({ image })]))[0]).toContain("image");
		},
	);

	it.each(["/og/hello.png", "https://cdn.example.com/a.png"])(
		"accepts image %j",
		(image) => {
			expect(site([post({ image })]).posts[0]?.image).toBe(image);
		},
	);

	it("reports duplicate slugs, drafts included", () => {
		const found = problems(() => site([post(), post({ draft: true })]));
		expect(found).toEqual(['duplicate slug "hello"']);
	});

	it("reports every problem at once, naming the post", () => {
		const found = problems(() =>
			site([post({ slug: "Bad" }), post({ slug: "ok", date: "nope" })], {
				siteUrl: "example.com",
				basePath: "blog",
			}),
		);
		expect(found).toHaveLength(4);
		expect(found.join("\n")).toContain('post "ok"');
	});

	it("rejects a non-function load", () => {
		expect(
			problems(() => site([post({ load: "x" as unknown as typeof load })]))[0],
		).toContain("load");
	});

	it.each(["ftp://example.com", "https://example.com/a?b=1", "https://"])(
		"rejects siteUrl %j",
		(siteUrl) => {
			expect(problems(() => site([post()], { siteUrl }))[0]).toContain(
				"siteUrl",
			);
		},
	);

	it.each(["/Blog", "/a//b", "/a b", "/"])("rejects basePath %j", (basePath) => {
		expect(problems(() => site([post()], { basePath }))[0]).toContain(
			"basePath",
		);
	});

	it("rejects a blank blog title", () => {
		expect(problems(() => site([post()], { title: "" }))[0]).toContain("title");
	});
});
