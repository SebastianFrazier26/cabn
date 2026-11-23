import type { ReactElement } from "react";
// The edge build's stream API waits for Suspense, which is how a lazy post
// gets into the output; the Node build's string renderers bail to the fallback.
import { renderToReadableStream } from "react-dom/server.edge";
import { describe, expect, it } from "vitest";
import { Blog, formatDay } from "../src/Blog.js";
import { Markdown, markdownPost } from "../src/Markdown.js";
import { createBlog, definePost } from "../src/post.js";

async function render(element: ReactElement): Promise<string> {
	const stream = await renderToReadableStream(element);
	await stream.allReady;
	return new Response(stream).text();
}

const blog = createBlog({
	title: "Field <Notes>",
	description: "Write-ups & experiments.",
	siteUrl: "https://example.com",
	posts: [
		definePost({
			slug: "older",
			title: "Older post",
			date: "2026-01-05",
			summary: "The older one.",
			load: markdownPost("Hello **there**."),
		}),
		definePost({
			slug: "custom",
			title: "Custom post",
			date: "2026-11-22",
			summary: "Owns its page.",
			layout: "bare",
			load: async () => ({
				default: () => <main className="x-post">custom body</main>,
			}),
		}),
		definePost({
			slug: "wip",
			title: "Unfinished",
			date: "2026-11-23",
			summary: "Not ready.",
			draft: true,
			load: markdownPost(async () => ({ default: "Draft text." })),
		}),
	],
});

describe("formatDay", () => {
	it("is fixed-format, not locale-dependent", () => {
		expect(formatDay("2026-01-05")).toBe("5 Jan 2026");
		expect(formatDay("2026-11-22")).toBe("22 Nov 2026");
	});
});

describe("<Blog> index", () => {
	it("lists published posts newest first with links, dates and summaries", async () => {
		const html = await render(
			<Blog blog={blog} route={{ kind: "index" }} homeHref="/" />,
		);
		expect(html.indexOf("Custom post")).toBeLessThan(
			html.indexOf("Older post"),
		);
		expect(html).toContain('href="/blog/custom/"');
		expect(html).toContain('<time dateTime="2026-01-05">5 Jan 2026</time>');
		expect(html).toContain("The older one.");
		expect(html).toContain('href="/blog/feed.xml"');
		expect(html).toContain('href="/"');
		expect(html).not.toContain("Unfinished");
	});

	it("escapes the blog title", async () => {
		const html = await render(<Blog blog={blog} route={{ kind: "index" }} />);
		expect(html).toContain("Field &lt;Notes&gt;");
		expect(html).not.toContain("<Notes>");
	});

	it("says so when there are no posts", async () => {
		const empty = createBlog({
			title: "Empty",
			description: "Nothing.",
			siteUrl: "https://example.com",
			posts: [],
		});
		const html = await render(<Blog blog={empty} route={{ kind: "index" }} />);
		expect(html).toContain("No posts yet");
	});
});

describe("<Blog> post", () => {
	it("wraps a standard post in the blog frame", async () => {
		const html = await render(
			<Blog blog={blog} route={{ kind: "post", slug: "older" }} />,
		);
		expect(html).toContain("cabn-blog-post");
		expect(html).toContain("<h1");
		expect(html).toContain("Older post");
		expect(html).toContain("<strong>there</strong>");
		expect(html).toContain('href="/blog/"');
	});

	it("renders a bare post with none of the blog's markup", async () => {
		const html = await render(
			<Blog blog={blog} route={{ kind: "post", slug: "custom" }} />,
		);
		expect(html).toContain('<main class="x-post">custom body</main>');
		expect(html).not.toContain("cabn-blog");
	});

	it("renders a draft at its URL, marked as one", async () => {
		const html = await render(
			<Blog blog={blog} route={{ kind: "post", slug: "wip" }} />,
		);
		expect(html).toContain("Draft text.");
		expect(html).toContain("Draft");
	});

	it.each(["missing", ""])("shows not-found for slug %j", async (slug) => {
		const html = await render(
			<Blog blog={blog} route={{ kind: "post", slug }} />,
		);
		expect(html).toContain("cabn-blog-missing");
		expect(html).toContain('href="/blog/"');
	});
});

describe("<Markdown>", () => {
	it("renders every block kind", async () => {
		const html = await render(
			<Markdown
				source={[
					"# Section",
					"para with `code` and [a link](https://x.dev/) and [in](/blog/x/)",
					"",
					"- one",
					"",
					"1. first",
					"",
					"> quoted",
					"",
					"![Alt text](/img/a.png)",
					"",
					"---",
					"",
					"```ts",
					"let a = 1 < 2;",
					"```",
				].join("\n")}
			/>,
		);
		// Shifted down one: the page's h1 is the post title.
		expect(html).toContain("<h2");
		expect(html).not.toContain("<h1");
		expect(html).toContain("<code>code</code>");
		expect(html).toContain(
			'<a href="https://x.dev/" target="_blank" rel="noopener noreferrer">a link</a>',
		);
		expect(html).toContain('<a href="/blog/x/">in</a>');
		expect(html).toContain("<ul><li>one</li></ul>");
		expect(html).toContain("<ol><li>first</li></ol>");
		expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
		expect(html).toContain(
			'<img src="/img/a.png" alt="Alt text" loading="lazy"/>',
		);
		expect(html).toContain("<hr/>");
		expect(html).toContain(
			'<pre><code class="language-ts">let a = 1 &lt; 2;</code></pre>',
		);
	});

	it("never emits raw HTML from the source", async () => {
		const html = await render(
			<Markdown
				source={'<img src=x onerror="alert(1)">\n\n<script>x</script>'}
			/>,
		);
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script>x");
		expect(html).toContain("&lt;script&gt;");
	});
});

describe("markdownPost", () => {
	it("accepts a string, a string loader and a ?raw module loader", async () => {
		for (const source of [
			"plain",
			async () => "plain",
			async () => ({ default: "plain" }),
		]) {
			const { default: Post } = await markdownPost(source)();
			expect(await render(<Post />)).toContain("plain");
		}
	});
});
