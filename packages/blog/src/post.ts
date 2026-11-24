import type { ComponentType } from "react";
import {
	type BlogTheme,
	type ResolvedBlogTheme,
	resolveTheme,
	themeProblems,
} from "./theme.js";

export type { BlogTheme } from "./theme.js";

export type PostLayout = "standard" | "bare";

/** What a dynamic `import()` of a post module resolves to. */
export type PostLoader = () => Promise<{ default: ComponentType }>;

export interface PostInput {
	/** URL segment: lowercase letters, digits and single hyphens. */
	slug: string;
	title: string;
	/** Publication day, `YYYY-MM-DD`. */
	date: string;
	/** One or two sentences: the index entry, the feed entry and the link preview. */
	summary: string;
	/**
	 * Must be lazy (`() => import("./Post.tsx")`): the build entry imports the
	 * post list in Node, where a component module and its CSS cannot load.
	 */
	load: PostLoader;
	updated?: string;
	/** Link-preview image: a site-relative path or an absolute https URL. */
	image?: string;
	/** Rendered at its URL but left out of the index, the feed and the sitemap. */
	draft?: boolean;
	/** `"bare"` hands the whole page to the post; `"standard"` wraps it in the blog's frame. */
	layout?: PostLayout;
}

export interface Post extends Readonly<PostInput> {
	readonly draft: boolean;
	readonly layout: PostLayout;
}

export interface BlogInput {
	title: string;
	description: string;
	/** The site's public address, e.g. `https://example.com`; canonical and feed URLs are built on it. */
	siteUrl: string;
	/** Where the blog is mounted. Defaults to `/blog`. */
	basePath?: string;
	author?: string;
	/** Colours, fonts and spacing for the index and the standard post frame. A `"bare"` post ignores it. */
	theme?: BlogTheme;
	posts: readonly PostInput[];
}

export interface Blog {
	readonly title: string;
	readonly description: string;
	readonly siteUrl: string;
	readonly basePath: string;
	readonly author?: string;
	readonly theme: ResolvedBlogTheme;
	/** Published posts, newest first. */
	readonly posts: readonly Post[];
	readonly drafts: readonly Post[];
	/** Looks through drafts too, so a draft can be previewed at its URL. */
	find(slug: string): Post | undefined;
}

export class BlogConfigError extends Error {
	readonly problems: readonly string[];

	constructor(problems: readonly string[]) {
		super(`invalid blog config:\n- ${problems.join("\n- ")}`);
		this.name = "BlogConfigError";
		this.problems = problems;
	}
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BASE_PATH_PATTERN = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const LAYOUTS: readonly string[] = ["standard", "bare"];

/** Identity; exists so a post literal is type-checked where it is written. */
export function definePost(post: PostInput): PostInput {
	return post;
}

function isRealDay(value: unknown): boolean {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	// Date.parse accepts 2026-02-30 and rolls it into March; the round trip
	// is what rejects it.
	const parsed = new Date(`${value}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

function isBlank(value: unknown): boolean {
	return typeof value !== "string" || value.trim() === "";
}

function isImageRef(value: string): boolean {
	if (/^\/(?![/\\])\S*$/.test(value)) return true;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function normalizeSiteUrl(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (!url.hostname || url.search || url.hash || url.username) return null;
	return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function postProblems(post: PostInput): string[] {
	const found: string[] = [];
	if (typeof post.slug !== "string" || !SLUG_PATTERN.test(post.slug)) {
		found.push(
			`slug ${JSON.stringify(post.slug)} must be lowercase letters, digits and single hyphens`,
		);
	}
	const name = `post ${JSON.stringify(post.slug)}`;
	if (isBlank(post.title)) found.push(`${name}: title is empty`);
	if (isBlank(post.summary)) found.push(`${name}: summary is empty`);
	if (!isRealDay(post.date)) {
		found.push(`${name}: date must be a real YYYY-MM-DD day`);
	}
	if (post.updated !== undefined && !isRealDay(post.updated)) {
		found.push(`${name}: updated must be a real YYYY-MM-DD day`);
	}
	if (post.layout !== undefined && !LAYOUTS.includes(post.layout)) {
		found.push(`${name}: layout must be "standard" or "bare"`);
	}
	if (
		post.image !== undefined &&
		(typeof post.image !== "string" || !isImageRef(post.image))
	) {
		found.push(`${name}: image must be a site-relative path or an https URL`);
	}
	if (typeof post.load !== "function") {
		found.push(`${name}: load must be a function returning import()`);
	}
	return found;
}

export function createBlog(input: BlogInput): Blog {
	const problems: string[] = [];
	if (isBlank(input.title)) problems.push("blog title is empty");
	if (isBlank(input.description)) problems.push("blog description is empty");

	const siteUrl = normalizeSiteUrl(input.siteUrl);
	if (siteUrl === null) {
		problems.push(
			`siteUrl ${JSON.stringify(input.siteUrl)} must be an http(s) URL without a query or fragment`,
		);
	}

	const basePath = (input.basePath ?? "/blog").replace(/(?<=.)\/$/, "");
	if (!BASE_PATH_PATTERN.test(basePath)) {
		problems.push(
			`basePath ${JSON.stringify(input.basePath)} must look like /blog or /notes/posts`,
		);
	}

	if (input.theme !== undefined) problems.push(...themeProblems(input.theme));

	const seen = new Set<string>();
	for (const post of input.posts) {
		const found = postProblems(post);
		problems.push(...found);
		if (found.length === 0 || SLUG_PATTERN.test(String(post.slug))) {
			if (seen.has(post.slug)) {
				problems.push(`duplicate slug ${JSON.stringify(post.slug)}`);
			}
			seen.add(post.slug);
		}
	}
	if (problems.length > 0 || siteUrl === null) {
		throw new BlogConfigError(problems);
	}

	const all: Post[] = input.posts
		.map((post) => ({
			...post,
			draft: post.draft === true,
			layout: post.layout ?? "standard",
		}))
		.sort(
			(a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug),
		);
	const bySlug = new Map(all.map((post) => [post.slug, post]));

	return {
		title: input.title,
		description: input.description,
		siteUrl,
		basePath,
		...(input.author === undefined ? {} : { author: input.author }),
		theme: resolveTheme(input.theme),
		posts: all.filter((post) => !post.draft),
		drafts: all.filter((post) => post.draft),
		find: (slug) => bySlug.get(slug),
	};
}
