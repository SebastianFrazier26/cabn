import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Blog, Post } from "../post.js";
import { renderAtomFeed } from "./feed.js";
import { type PageMeta, renderPageHtml } from "./page.js";
import { renderSitemap } from "./sitemap.js";
import { feedUrl, indexUrl, lastChanged, postUrl } from "./urls.js";

export interface WriteBlogPagesOptions {
	blog: Blog;
	/** The built site's output directory, e.g. Vite's `dist`. */
	distDir: string;
	/** The app shell to copy per page. Defaults to `<distDir>/index.html`. */
	shellHtml?: string;
}

function postMeta(blog: Blog, post: Post): PageMeta {
	const changed = lastChanged(post);
	return {
		title: `${post.title} · ${blog.title}`,
		description: post.summary,
		url: postUrl(blog, post),
		siteName: blog.title,
		feedUrl: feedUrl(blog),
		type: "article",
		publishedTime: post.date,
		...(changed === post.date ? {} : { modifiedTime: changed }),
		...(post.image === undefined
			? {}
			: {
					image: post.image.startsWith("/")
						? `${blog.siteUrl}${post.image}`
						: post.image,
				}),
		...(post.draft ? { noindex: true } : {}),
	};
}

/**
 * Run after the site's own build. Writes, under `<distDir><basePath>/`:
 * `index.html`, `<slug>/index.html` for every post (drafts included, marked
 * noindex), `feed.xml` and `sitemap.xml`. Returns the paths written, relative
 * to `distDir`.
 */
export function writeBlogPages({
	blog,
	distDir,
	shellHtml,
}: WriteBlogPagesOptions): string[] {
	let shell = shellHtml;
	if (shell === undefined) {
		const shellPath = join(distDir, "index.html");
		try {
			shell = readFileSync(shellPath, "utf8");
		} catch {
			throw new Error(
				`${shellPath} not found: build the site before writing blog pages`,
			);
		}
	}

	const base = blog.basePath.slice(1);
	const files: [path: string, content: string][] = [
		[
			`${base}/index.html`,
			renderPageHtml(shell, {
				title: blog.title,
				description: blog.description,
				url: indexUrl(blog),
				siteName: blog.title,
				feedUrl: feedUrl(blog),
				type: "website",
			}),
		],
	];
	const everyPost = [...blog.posts, ...blog.drafts].sort((a, b) =>
		a.slug.localeCompare(b.slug),
	);
	for (const post of everyPost) {
		files.push([
			`${base}/${post.slug}/index.html`,
			renderPageHtml(shell, postMeta(blog, post)),
		]);
	}
	files.push(
		[`${base}/feed.xml`, renderAtomFeed(blog)],
		[`${base}/sitemap.xml`, renderSitemap(blog)],
	);

	for (const [path, content] of files) {
		const target = join(distDir, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	return files.map(([path]) => path);
}
