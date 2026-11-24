import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	renderAtomFeed,
	renderPageHtml,
	renderSitemap,
	writeBlogPages,
} from "../src/build/index.js";
import { createBlog, definePost } from "../src/post.js";

const load = async () => ({ default: () => null });

const blog = createBlog({
	title: 'Field "Notes" & <more>',
	description: "Write-ups & experiments.",
	siteUrl: "https://example.com",
	author: "A. Writer",
	posts: [
		definePost({
			slug: "older",
			title: "Older",
			date: "2026-01-05",
			updated: "2026-02-01",
			summary: "The older one.",
			load,
		}),
		definePost({
			slug: "newer",
			title: 'Is 1 < 2 & "true"?',
			date: "2026-11-22",
			summary: "Costs $1 & change </script>",
			image: "/og/newer.png",
			load,
		}),
		definePost({
			slug: "wip",
			title: "Unfinished",
			date: "2026-11-23",
			summary: "Not ready.",
			draft: true,
			load,
		}),
	],
});

const SHELL = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="default-src 'self'" />
		<title>My site</title>
		<meta name="description" content="Site-wide description" />
		<script type="module" src="/assets/index-abc12345.js"></script>
	</head>
	<body><div id="root"></div></body>
</html>
`;

describe("renderAtomFeed", () => {
	const feed = renderAtomFeed(blog);

	it("is an Atom feed with ids, links and dates", () => {
		expect(feed.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(
			true,
		);
		expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
		expect(feed).toContain("<id>https://example.com/blog/</id>");
		expect(feed).toContain(
			'<link rel="self" type="application/atom+xml" href="https://example.com/blog/feed.xml"/>',
		);
		expect(feed).toContain("<id>https://example.com/blog/older/</id>");
		expect(feed).toContain("<published>2026-01-05T00:00:00Z</published>");
		expect(feed).toContain("<updated>2026-02-01T00:00:00Z</updated>");
		expect(feed).toContain("<name>A. Writer</name>");
	});

	it("dates the feed by its most recent change", () => {
		expect(feed).toContain(
			"<subtitle>Write-ups &amp; experiments.</subtitle>\n\t<updated>2026-11-22T00:00:00Z</updated>",
		);
	});

	it("lists newest first and leaves drafts out", () => {
		expect(feed.indexOf("/blog/newer/")).toBeLessThan(
			feed.indexOf("/blog/older/"),
		);
		expect(feed).not.toContain("Unfinished");
	});

	it("escapes text", () => {
		expect(feed).toContain(
			"<title>Field &quot;Notes&quot; &amp; &lt;more&gt;</title>",
		);
		expect(feed).toContain("Costs $1 &amp; change &lt;/script&gt;");
		expect(feed).not.toContain("</script>");
	});

	it("is well-formed for a blog with no posts", () => {
		const empty = createBlog({
			title: "Empty",
			description: "Nothing.",
			siteUrl: "https://example.com",
			posts: [],
		});
		const xml = renderAtomFeed(empty);
		expect(xml).toContain("<updated>1970-01-01T00:00:00Z</updated>");
		expect(xml).not.toContain("<entry>");
	});
});

describe("renderSitemap", () => {
	it("lists the index and published posts with last-modified days", () => {
		const xml = renderSitemap(blog);
		expect(xml).toContain("<loc>https://example.com/blog/</loc>");
		expect(xml).toContain(
			"<loc>https://example.com/blog/older/</loc><lastmod>2026-02-01</lastmod>",
		);
		expect(xml).toContain("<loc>https://example.com/blog/newer/</loc>");
		expect(xml).not.toContain("wip");
	});
});

describe("renderPageHtml", () => {
	const html = renderPageHtml(SHELL, {
		title: 'Is 1 < 2 & "true"? · Notes',
		description: "Costs $1 & change </script>",
		url: "https://example.com/blog/newer/",
		siteName: "Notes",
		feedUrl: "https://example.com/blog/feed.xml",
		type: "article",
		image: "https://example.com/og/newer.png",
		publishedTime: "2026-11-22",
	});

	it("replaces the title and the site-wide description", () => {
		expect(html).toContain(
			"<title>Is 1 &lt; 2 &amp; &quot;true&quot;? · Notes</title>",
		);
		expect(html).not.toContain("My site");
		expect(html).not.toContain("Site-wide description");
		expect(html.match(/<title>/g)).toHaveLength(1);
		expect(html.match(/name="description"/g)).toHaveLength(1);
	});

	it("adds canonical, Open Graph, Twitter and feed tags before </head>", () => {
		for (const tag of [
			'<link rel="canonical" href="https://example.com/blog/newer/" />',
			'<meta property="og:type" content="article" />',
			'<meta property="og:url" content="https://example.com/blog/newer/" />',
			'<meta property="og:site_name" content="Notes" />',
			'<meta property="og:image" content="https://example.com/og/newer.png" />',
			'<meta property="article:published_time" content="2026-11-22" />',
			'<meta name="twitter:card" content="summary_large_image" />',
			'<link rel="alternate" type="application/atom+xml" href="https://example.com/blog/feed.xml" />',
		]) {
			expect(html).toContain(tag);
		}
		expect(html.indexOf("og:type")).toBeLessThan(html.indexOf("</head>"));
	});

	it("escapes attribute values, including $ sequences", () => {
		expect(html).toContain('content="Costs $1 &amp; change &lt;/script&gt;"');
	});

	it("leaves the rest of the shell alone", () => {
		expect(html).toContain(
			`<meta http-equiv="Content-Security-Policy" content="default-src 'self'" />`,
		);
		expect(html).toContain(
			'<script type="module" src="/assets/index-abc12345.js"></script>',
		);
		expect(html).toContain('<div id="root"></div>');
		expect(html).not.toMatch(/<script(?![^>]*src=)/);
	});

	it("uses the small card and no image tags without an image, and can mark noindex", () => {
		const plain = renderPageHtml(SHELL, {
			title: "T",
			description: "D",
			url: "https://example.com/blog/",
			siteName: "Notes",
			feedUrl: "https://example.com/blog/feed.xml",
			type: "website",
			noindex: true,
		});
		expect(plain).toContain('<meta name="twitter:card" content="summary" />');
		expect(plain).not.toContain("og:image");
		expect(plain).not.toContain("article:published_time");
		expect(plain).toContain('<meta name="robots" content="noindex" />');
	});

	it("adds a title when the shell has none and refuses a shell with no head", () => {
		expect(
			renderPageHtml("<html><head></head><body></body></html>", {
				title: "T",
				description: "D",
				url: "https://example.com/blog/",
				siteName: "Notes",
				feedUrl: "https://example.com/blog/feed.xml",
				type: "website",
			}),
		).toContain("<title>T</title>");
		expect(() =>
			renderPageHtml("<p>nope</p>", {
				title: "T",
				description: "D",
				url: "u",
				siteName: "s",
				feedUrl: "f",
				type: "website",
			}),
		).toThrow(/<\/head>/);
	});
});

describe("writeBlogPages", () => {
	let dir = "";
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("writes a page per post, the index, the feed and the sitemap", () => {
		dir = mkdtempSync(join(tmpdir(), "cabn-blog-"));
		writeFileSync(join(dir, "index.html"), SHELL);
		const written = writeBlogPages({ blog, distDir: dir });
		expect(written).toEqual([
			"blog/index.html",
			"blog/newer/index.html",
			"blog/older/index.html",
			"blog/wip/index.html",
			"blog/feed.xml",
			"blog/sitemap.xml",
		]);

		const index = readFileSync(join(dir, "blog/index.html"), "utf8");
		expect(index).toContain(
			"<title>Field &quot;Notes&quot; &amp; &lt;more&gt;</title>",
		);
		expect(index).toContain('<meta property="og:type" content="website" />');

		const newer = readFileSync(join(dir, "blog/newer/index.html"), "utf8");
		expect(newer).toContain(
			'<meta property="og:image" content="https://example.com/og/newer.png" />',
		);
		expect(newer).toContain(
			'<link rel="canonical" href="https://example.com/blog/newer/" />',
		);
		expect(newer).not.toContain("noindex");

		const older = readFileSync(join(dir, "blog/older/index.html"), "utf8");
		expect(older).toContain(
			'<meta property="article:modified_time" content="2026-02-01" />',
		);

		const draft = readFileSync(join(dir, "blog/wip/index.html"), "utf8");
		expect(draft).toContain('<meta name="robots" content="noindex" />');

		expect(readFileSync(join(dir, "blog/feed.xml"), "utf8")).toContain("<feed");
		expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(SHELL);
	});

	it("takes the shell as text and honours the base path", () => {
		dir = mkdtempSync(join(tmpdir(), "cabn-blog-"));
		const custom = createBlog({
			title: "Notes",
			description: "D",
			siteUrl: "https://example.com",
			basePath: "/writing/notes",
			posts: [
				definePost({
					slug: "a",
					title: "A",
					date: "2026-01-01",
					summary: "S",
					load,
				}),
			],
		});
		expect(
			writeBlogPages({ blog: custom, distDir: dir, shellHtml: SHELL }),
		).toContain("writing/notes/a/index.html");
	});

	it("fails clearly when the built shell is missing", () => {
		dir = mkdtempSync(join(tmpdir(), "cabn-blog-"));
		expect(() => writeBlogPages({ blog, distDir: dir })).toThrow(/index\.html/);
	});
});
