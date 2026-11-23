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

## Theming

The default look is cabn's pixel UI: light by day, dark by night, following the reader's system setting. It is meant to be replaced. Every colour, font and size the stylesheet uses is a CSS custom property named `--cabn-blog-<token>`, and there are three ways to change them, from lightest to heaviest.

**1. A theme on the blog.** Token names are camelCase here and type-checked; an unknown one fails `createBlog`.

```ts
export const blog = createBlog({
	// …
	theme: {
		scheme: "light", // "auto" (default) | "light" | "dark"
		className: "my-blog",
		tokens: {
			page: "#0b1d2a",
			pageBand: "#c96f3b",
			panel: "#0f3d2e",
			text: "#f4f1e6",
			link: "#ffc857",
			fontDisplay: '"Scorebug", "Arial Narrow", sans-serif',
			radius: "2px",
		},
	},
});
```

Tokens set this way apply in both schemes. `scheme` pins the built-in light or dark set instead of following the system.

**2. Your own stylesheet.** Set the properties on `.cabn-blog`. The defaults have zero specificity, so a plain rule wins whatever order the stylesheets load in, in dark mode too. This is the way to give light and dark different values:

```css
.cabn-blog {
	--cabn-blog-panel: #fffdf5;
	--cabn-blog-font-display: "Scorebug", sans-serif;
}
@media (prefers-color-scheme: dark) {
	.cabn-blog {
		--cabn-blog-panel: #161616;
	}
}
```

You can also restyle the blog's elements directly; their classes all start with `cabn-blog-` (`-masthead`, `-card`, `-panel`, `-nav`, `-meta`, `-md`, …), and `theme.className` adds a class of yours to the root. Skipping `@cabn/blog/styles.css` altogether and writing all of it yourself works too.

**3. `layout: "bare"` on a post.** The post renders with none of the blog's markup or styles and owns the whole page. See the next section.

| Token | CSS property | Default (light) | Used for |
|---|---|---|---|
| `page` | `--cabn-blog-page` | `#bfe9ff` | page background |
| `pageBand` | `--cabn-blog-page-band` | `#8fd694` | the strip along the bottom of the page |
| `panel` | `--cabn-blog-panel` | `#f2f8ff` | cards, the post frame, buttons |
| `panelAlt` | `--cabn-blog-panel-alt` | `#dff0ff` | code backgrounds |
| `border` | `--cabn-blog-border` | `#3b2f6b` | panel outlines |
| `highlight` | `--cabn-blog-highlight` | `#8fd6ef` | the panels' inner line, dotted rules |
| `text` | `--cabn-blog-text` | `#201a3d` | body text |
| `textSoft` | `--cabn-blog-text-soft` | `#55507f` | dates, descriptions, quotes |
| `link` / `linkHover` | `--cabn-blog-link` / `-link-hover` | `#1a7b81` / `#d8106a` | links |
| `accent` / `accentInk` | `--cabn-blog-accent` / `-accent-ink` | `#ffd23f` / `#201a3d` | focus ring, button hover, draft badge, and the text on them |
| `quote` | `--cabn-blog-quote` | `#ef5fa0` | blockquote bar |
| `code` | `--cabn-blog-code` | `#7a5ad4` | inline code text |
| `shadow` | `--cabn-blog-shadow` | `rgba(32, 26, 61, 0.22)` | the hard offset shadow |
| `fontDisplay` | `--cabn-blog-font-display` | DotGothic16 | headings, dates, navigation |
| `fontProse` | `--cabn-blog-font-prose` | system sans-serif | body text |
| `fontMono` | `--cabn-blog-font-mono` | system monospace | code |
| `fontSize` | `--cabn-blog-font-size` | `1.0625rem` | body text size |
| `width` | `--cabn-blog-width` | `720px` | content column |
| `pad` / `gap` | `--cabn-blog-pad` / `-gap` | `24px` / `20px` | panel padding, space between panels |
| `radius` / `borderWidth` | `--cabn-blog-radius` / `-border-width` | `14px` / `4px` | panel corners and outline |

`BLOG_THEME_TOKENS` and `tokenProperty()` export the same list for tooling. Theme tokens reach the page as inline custom properties that React sets through the DOM, which a `style-src` policy does not restrict.

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
}
file_server
```

Keep the `handle`: `try_files` takes no matcher of its own, and written as `try_files @blog …` it applies to every request.

## Content Security Policy

The package adds no inline scripts and injects no styles at run time. `script-src 'self'` and `style-src 'self'` are enough for the package itself. The stylesheet loads one font file from beside it, which a bundler emits as a same-origin asset (`font-src 'self'`).

## Licence

MIT. The bundled DotGothic16 font is under the SIL Open Font License; see `third-party-licenses/`.
