import type { Blog, Post } from "../post.js";
import { indexHref, postHref } from "../route.js";

export function indexUrl(blog: Blog): string {
	return `${blog.siteUrl}${indexHref(blog.basePath)}`;
}

export function postUrl(blog: Blog, post: Post): string {
	return `${blog.siteUrl}${postHref(blog.basePath, post.slug)}`;
}

export function feedUrl(blog: Blog): string {
	return `${blog.siteUrl}${blog.basePath}/feed.xml`;
}

/** The day a post last changed. */
export function lastChanged(post: Post): string {
	return post.updated !== undefined && post.updated > post.date
		? post.updated
		: post.date;
}
