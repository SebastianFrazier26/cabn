import {
	Component,
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	type ReactElement,
	type ReactNode,
	Suspense,
	useEffect,
} from "react";
import { BlogLink, NavigateContext } from "./BlogLink.js";
import type { Blog as BlogData, Post } from "./post.js";
import { type BlogRoute, indexHref, postHref } from "./route.js";

export interface BlogProps {
	blog: BlogData;
	/** From `parseBlogRoute`; the host renders `<Blog>` only when it is non-null. */
	route: BlogRoute;
	/** The host router's push-state navigate. Without it, links are plain page loads. */
	onNavigate?: (href: string) => void;
	/** Where the "home" link on the index goes; omitted, there is no such link. */
	homeHref?: string;
	homeLabel?: string;
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** `2026-01-05` as `5 Jan 2026`. Fixed rather than `Intl`, so every reader and the tests see the same text. */
export function formatDay(day: string): string {
	const [year, month, date] = day.split("-").map(Number);
	return `${date} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

// React.lazy must be called once per post, not once per render, or every
// render would start a new load and remount the post.
const lazyPosts = new WeakMap<Post, LazyExoticComponent<ComponentType>>();

function lazyPost(post: Post): LazyExoticComponent<ComponentType> {
	let component = lazyPosts.get(post);
	if (!component) {
		component = lazy(post.load);
		lazyPosts.set(post, component);
	}
	return component;
}

function useDocumentTitle(title: string): void {
	useEffect(() => {
		document.title = title;
	}, [title]);
}

/** A post's chunk can fail to download (offline, or a deploy replaced it). */
class PostErrorBoundary extends Component<
	{ children: ReactNode; fallback: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	override render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

function Loading(): ReactElement {
	return (
		<p className="cabn-blog-loading" role="status">
			Loading…
		</p>
	);
}

function LoadFailed({ href }: { href: string }): ReactElement {
	return (
		<div className="cabn-blog cabn-blog-missing">
			<p>This post didn't load.</p>
			<p>
				<a href={href}>Try again</a>
			</p>
		</div>
	);
}

function Index({
	blog,
	homeHref,
	homeLabel,
}: Pick<BlogProps, "blog" | "homeHref" | "homeLabel">): ReactElement {
	useDocumentTitle(blog.title);
	return (
		<main className="cabn-blog cabn-blog-index">
			<header className="cabn-blog-masthead">
				{homeHref !== undefined && (
					<nav className="cabn-blog-nav">
						<BlogLink href={homeHref}>← {homeLabel ?? "Home"}</BlogLink>
					</nav>
				)}
				<h1>{blog.title}</h1>
				<p>{blog.description}</p>
			</header>
			{blog.posts.length === 0 ? (
				<p className="cabn-blog-empty">No posts yet.</p>
			) : (
				<ol className="cabn-blog-list">
					{blog.posts.map((post) => (
						<li key={post.slug}>
							<article className="cabn-blog-card">
								<h2>
									<BlogLink href={postHref(blog.basePath, post.slug)}>
										{post.title}
									</BlogLink>
								</h2>
								<time dateTime={post.date}>{formatDay(post.date)}</time>
								<p>{post.summary}</p>
							</article>
						</li>
					))}
				</ol>
			)}
			<footer className="cabn-blog-foot">
				<a href={`${blog.basePath}/feed.xml`}>Feed</a>
			</footer>
		</main>
	);
}

function Missing({ blog }: { blog: BlogData }): ReactElement {
	useDocumentTitle(`Not found · ${blog.title}`);
	return (
		<main className="cabn-blog cabn-blog-missing">
			<h1>No post here</h1>
			<p>
				<BlogLink href={indexHref(blog.basePath)}>
					← All posts on {blog.title}
				</BlogLink>
			</p>
		</main>
	);
}

function PostPage({
	blog,
	post,
}: {
	blog: BlogData;
	post: Post;
}): ReactElement {
	useDocumentTitle(`${post.title} · ${blog.title}`);
	const Body = lazyPost(post);
	const body = (
		<PostErrorBoundary
			fallback={<LoadFailed href={postHref(blog.basePath, post.slug)} />}
		>
			<Suspense fallback={<Loading />}>
				<Body />
			</Suspense>
		</PostErrorBoundary>
	);
	if (post.layout === "bare") return body;
	return (
		<main className="cabn-blog cabn-blog-post">
			<nav className="cabn-blog-nav">
				<BlogLink href={indexHref(blog.basePath)}>← {blog.title}</BlogLink>
			</nav>
			<article className="cabn-blog-panel">
				<header>
					{post.draft && <p className="cabn-blog-draft">Draft</p>}
					<h1>{post.title}</h1>
					<p className="cabn-blog-meta">
						<time dateTime={post.date}>{formatDay(post.date)}</time>
						{post.updated !== undefined && (
							<>
								{" · updated "}
								<time dateTime={post.updated}>{formatDay(post.updated)}</time>
							</>
						)}
					</p>
				</header>
				<div className="cabn-blog-body">{body}</div>
			</article>
		</main>
	);
}

/** The blog's index, one post, or not-found, depending on `route`. */
export function Blog({
	blog,
	route,
	onNavigate,
	homeHref,
	homeLabel,
}: BlogProps): ReactElement {
	const post = route.kind === "post" ? blog.find(route.slug) : undefined;
	return (
		<NavigateContext.Provider value={onNavigate ?? null}>
			{route.kind === "index" ? (
				<Index blog={blog} homeHref={homeHref} homeLabel={homeLabel} />
			) : post ? (
				// Keyed so moving between posts remounts instead of reusing state.
				<PostPage key={post.slug} blog={blog} post={post} />
			) : (
				<Missing blog={blog} />
			)}
		</NavigateContext.Provider>
	);
}
