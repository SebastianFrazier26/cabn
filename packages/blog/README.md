# @cabn/blog

A blog for React sites built with cabn. It is separate from the game: it does not import `@cabn/engine`, and a blog page downloads none of it.

- A post is a React component loaded as its own chunk. It can bring its own CSS, fonts and libraries.
- A prose post is a markdown file plus a few lines of metadata.
- `<Blog>` renders the index at `/blog/` and each post at `/blog/<slug>/`.
- A build step writes one HTML page per post with its title and link-preview tags, an Atom feed and a sitemap.

## Define the posts

```ts
// src/posts.ts
import { createBlog, definePost, markdownPost } from "@cabn/blog";

export const blog = createBlog({
	title: "My notes",
	description: "Write-ups on the things I build.",
	siteUrl: "https://example.com",
	posts: [
		definePost({
			slug: "scroll-story",
			title: "A scroll-driven story",
			date: "2026-11-22",
			summary: "One or two sentences for the index, the feed and link previews.",
			layout: "bare",
			load: () => import("./blog/scroll-story/Post.tsx"),
		}),
		definePost({
			slug: "hello",
			title: "Hello",
			date: "2026-11-21",
			summary: "A first post.",
			load: markdownPost(() => import("./blog/hello.md?raw")),
		}),
	],
});
```

This file is also imported by your build script in Node, so every `load` must be lazy (`() => import(...)`). A top-level import of a component or stylesheet here would break the build step.

`createBlog` validates everything and throws one `BlogConfigError` listing every problem.

| Field | Rule |
|---|---|
| `slug` | lowercase letters, digits, single hyphens; unique |
| `date`, `updated` | a real `YYYY-MM-DD` day |
| `title`, `summary` | not empty |
| `layout` | `"standard"` (default) or `"bare"` |
| `image` | a site-relative path or an `https:` URL, for the link-preview image |
| `draft` | `true` keeps the post out of the index, feed and sitemap; its URL still works, marked `noindex` |

`basePath` defaults to `/blog`.

## Mount it

```tsx
import { Blog, parseBlogRoute } from "@cabn/blog";
import "@cabn/blog/styles.css";
import { blog } from "./posts.ts";

const route = parseBlogRoute(window.location.pathname, blog.basePath);
if (route) {
	return <Blog blog={blog} route={route} onNavigate={navigate} homeHref="/" />;
}
```

`parseBlogRoute` returns `null` for a path outside the blog. `onNavigate` is your router's push-state function; with it, plain left clicks on the blog's links stay in the app, and modified clicks are left to the browser. Without it, links are ordinary page loads.

## Layouts and per-post styling

- **`standard`** wraps the post in the blog's frame: a link back to the index, the title and date, and a panel in cabn's pixel UI style. It follows the reader's light or dark preference.
- **`bare`** renders only your component. The post owns the whole page, including its own way back.

Keep a post's styles inside the post: give its root element one class and start every selector with it. A test can enforce that:

```ts
import { findUnscopedSelectors } from "@cabn/blog/build";

const report = findUnscopedSelectors(readFileSync("src/blog/scroll-story/post.css", "utf8"), ".scroll-story");
expect(report.selectors).toEqual([]);
```

`report.globals` lists `@font-face`, `@keyframes`, `@property` and `@import` rules, which are global wherever they are written; give their names a per-post prefix.

## Markdown posts

`markdownPost` takes the text, or a loader for it. The renderer supports headings, paragraphs, bullet and numbered lists, blockquotes, fenced code, standalone images, horizontal rules, and inline bold, italic, code and links. It builds React elements and never inserts HTML, so raw HTML in a post shows as text. Links and images must be `http(s):` URLs or site-relative paths; anything else renders as plain text. Headings are shifted down one level because the page's `h1` is the post title.

## Build step

Run after your site's build:

```ts
import { writeBlogPages } from "@cabn/blog/build";
import { blog } from "../src/posts.ts";

writeBlogPages({ blog, distDir: "dist" });
```

It copies `dist/index.html` to `dist/blog/index.html` and `dist/blog/<slug>/index.html`, replacing `<title>` and the description and adding canonical, Open Graph, Twitter and feed tags. The rest of the shell is untouched, and the post body still renders in the browser. It also writes `dist/blog/feed.xml` (Atom) and `dist/blog/sitemap.xml`.

Your static server must serve those files and fall back to the app shell for a blog path that has none, so the app can show its not-found view. For Caddy:

```
@blog path /blog /blog/*
handle @blog {
	try_files {path} {path}/index.html /index.html
	file_server
}
```

## Content Security Policy

The package adds no inline scripts and injects no styles at run time. `script-src 'self'` and `style-src 'self'` are enough for the package itself. The stylesheet loads one font file from beside it, which a bundler emits as a same-origin asset (`font-src 'self'`).

## Licence

MIT. The bundled DotGothic16 font is under the SIL Open Font License; see `third-party-licenses/`.
