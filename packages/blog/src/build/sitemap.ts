import type { Blog } from "../post.js";
import { escapeMarkup } from "./escape.js";
import { indexUrl, lastChanged, postUrl } from "./urls.js";

/** The blog's own URLs only; a site with other pages lists this file from a sitemap index or merges it. */
export function renderSitemap(blog: Blog): string {
	const lines = [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		`\t<url><loc>${escapeMarkup(indexUrl(blog))}</loc></url>`,
	];
	for (const post of blog.posts) {
		lines.push(
			`\t<url><loc>${escapeMarkup(postUrl(blog, post))}</loc><lastmod>${lastChanged(post)}</lastmod></url>`,
		);
	}
	lines.push("</urlset>", "");
	return lines.join("\n");
}
