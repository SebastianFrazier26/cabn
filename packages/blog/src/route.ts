import { SLUG_PATTERN } from "./post.js";

export type BlogRoute = { kind: "index" } | { kind: "post"; slug: string };

/**
 * `null` means the path is outside the blog. A path inside it that names no
 * valid slug comes back as a post with an empty slug, which no post can have,
 * so the caller's lookup fails and it shows not-found instead of falling
 * through to another page.
 */
export function parseBlogRoute(
	pathname: string,
	basePath = "/blog",
): BlogRoute | null {
	if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
		return null;
	}
	const rest = pathname.slice(basePath.length);
	if (rest === "" || rest === "/") return { kind: "index" };
	const slug = rest.slice(1).replace(/\/$/, "");
	return { kind: "post", slug: SLUG_PATTERN.test(slug) ? slug : "" };
}

// Trailing slashes: the build writes <slug>/index.html, and static servers
// redirect the slashless form to the directory.
export function indexHref(basePath: string): string {
	return `${basePath}/`;
}

export function postHref(basePath: string, slug: string): string {
	return `${basePath}/${slug}/`;
}
