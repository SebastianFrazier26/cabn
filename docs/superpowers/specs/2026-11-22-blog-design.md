# `@cabn/blog` design

Date: 2026-11-22. Status: approach approved by the owner; this doc records it.

## Intent

The owner wants a blog on sebastianfrazier.com whose posts can each have their own
look and interactive React components. Their words: "the blog should be a separate
feature on cabn that allows blog posts with custom styling. It shouldn't be tied to
a world at all." The first real post is a scroll-driven data piece (GSAP, self-hosted
font) about fan sentiment; the existing blog is a cabn world of plain markdown files,
which cannot do that.

## Goals

- A cabn package any React site can mount to get `/blog` (index) and `/blog/<slug>`.
- A post is free to own its whole page: its own CSS, fonts, components.
- A prose-only post stays cheap: one markdown file plus a few lines of metadata.
- Each post is its own lazy chunk. A blog page never downloads the game engine.
- Link previews work: each post URL serves HTML with its own title and OG tags.
- An Atom feed and a sitemap.
- Works under the portfolio's CSP as it stands (`script-src 'self'`, `font-src 'self' data:`).

## Non-goals

- Server-side rendering of post bodies (meta-only pages were chosen).
- MDX (can be added later as another way to produce a post component).
- Embedding posts inside worlds. Worlds link to posts with ordinary navigation. No
  CSP, `frame-ancestors` or `X-Frame-Options` change.
- Comments, tags pages, pagination, search.

## Anti-goals

- The blog must not import `@cabn/engine`, Phaser or CodeMirror, directly or transitively.
- No inline scripts and no runtime `<style>` injection from the package.
- A markdown post must never render raw HTML.

## Constraints found in the code

- cabn has no router. `@cabn/engine` exports a component (`CabnGame`); the host app
  owns routing. The portfolio's router is a hand-written path check in `src/App.tsx`.
- The portfolio is a client-rendered Vite SPA served by Caddy; `/play` is rewritten to
  `index.html`. Its CSP is emitted both as a `<meta>` tag in `index.html` and as a header.
- Publishable cabn packages build with plain `tsc` to `dist/`, ESM only, no bundler.
- The portfolio runs `.ts` build scripts directly with Node's type stripping.
- A new npm package needs one manual first publish before trusted publishing can be attached.

## Approaches

Authoring format:

1. **TS module per post (picked).** A post is metadata plus a lazy loader for a React
   component. Full styling freedom, no new tooling, and the fan-sentiment prototype
   already has this shape. Prose posts use a `markdownPost()` helper.
2. MDX. Natural for prose with a few widgets, but needs a compiler and a Vite plugin
   that cabn would have to ship; the first post is nearly all component.
3. Markdown with registered components. Lets posts live in a separate content repo,
   but per-post styling is limited to what the registered components allow.

Package boundary: a new **`@cabn/blog`** (picked) over an `@cabn/engine/blog` subpath.
The new package depends only on React and reads as a separate feature; the cost is one
manual first publish by the owner.

Prerender: **meta-only pages** (picked) over full static rendering. The build copies the
app's `index.html` per post with title, description, canonical, OG and Twitter tags
filled in. Full static rendering would force every post to be server-render-safe.

## Design

### Package layout

`packages/blog`, published as `@cabn/blog`, version 0.1.0, MIT, ESM, peer `react >= 18`.
No runtime dependencies.

| Entry | Runs in | Contents |
|---|---|---|
| `@cabn/blog` | browser | `definePost`, `createBlog`, `parseBlogRoute`, `<Blog>`, `markdownPost`, `<Markdown>`, types |
| `@cabn/blog/build` | Node | `renderAtomFeed`, `renderSitemap`, `renderPageHtml`, `writeBlogPages`, `findUnscopedSelectors` |
| `@cabn/blog/styles.css` | bundler | the index and standard-layout styles, plus the pixel font file beside it |

The build entry imports nothing from React and nothing from the browser entry's
components, so a Node script can load it without a JSX or CSS loader.

### Posts

```ts
// posts.ts in the host site. Must be importable by Node: lazy imports only.
export const blog = createBlog({
	title: "Sebastian Frazier",
	description: "Notes and write-ups.",
	siteUrl: "https://sebastianfrazier.com",
	posts: [
		definePost({
			slug: "fan-sentiment",
			title: "Are the fans always right?",
			date: "2026-11-22",
			summary: "…",
			layout: "bare",
			load: () => import("./blog/fan-sentiment/FanSentimentPost.tsx"),
		}),
		definePost({
			slug: "hello",
			title: "Hello",
			date: "2026-11-21",
			summary: "…",
			load: markdownPost(() => import("./blog/hello.md?raw")),
		}),
	],
});
```

- `slug`: lowercase letters, digits and single hyphens. `date`: a real `YYYY-MM-DD`.
  `title` and `summary`: non-empty. Optional `updated`, `image` (site-relative or
  absolute https URL, for `og:image`), `draft`, `layout` (`"standard"` default, or `"bare"`).
- `createBlog` validates every post and throws one error listing every problem,
  including duplicate slugs. It returns posts sorted newest first. Drafts are kept in
  `blog.drafts` and left out of `blog.posts`, the index, the feed and the sitemap; a
  draft still renders at its URL so it can be previewed.
- `basePath` defaults to `/blog`.

### Layouts and style isolation

- **`standard`**: the package's shell: a back link to the index, title, date, then the
  post inside a flat pixel-RPG panel (cabn's Meadow day palette and DotGothic16 font,
  clean borders, no texture), matching the engine's HUD panels. Follows
  `prefers-color-scheme` to the Berry night palette.
- **`bare`**: the package renders only the post component. The post owns the page.
- Isolation is by convention plus a check: every selector in a post's stylesheet starts
  with that post's root class. `findUnscopedSelectors(css, ".fs-post")` returns the
  offenders, and the host site asserts it is empty in a test. `@keyframes`, `@font-face`
  and `@property` are global by nature and are reported separately as names, so a test
  can require a prefix. Shadow DOM was rejected: it fights scroll-driven animation
  libraries and font loading.
- The package's own classes are all prefixed `cabn-blog-`.

### Theming (added 2026-11-23 on the owner's instruction)

The owner's words: the default scheme "seems fine for normal blogs but it should be very
easily overridable by users so they can use custom styling". So the Meadow/Berry look stays
the default and theming is a documented API:

- Every colour, font and size in the stylesheet is a custom property, `--cabn-blog-<token>`.
  `BLOG_THEME_TOKENS` in `src/theme.ts` is the list; a test keeps it and the stylesheet in step.
- Defaults are declared inside `:where()`, so a site's plain `.cabn-blog { … }` rule wins
  regardless of load order and in dark mode.
- `createBlog({ theme: { scheme, tokens, className } })`: validated token overrides applied
  as inline custom properties on the root, a pinned light or dark scheme, and extra root classes.
- `layout: "bare"` remains the route to fully custom pages.

### Routing

`parseBlogRoute(pathname, basePath?)` is pure and returns `{ kind: "index" }`,
`{ kind: "post", slug }` or `null` (not a blog URL). The host router calls it and, when
non-null, renders:

```tsx
<Blog blog={blog} route={route} onNavigate={navigate} homeHref="/" />
```

`<Blog>` renders the index, a post (lazy, inside `Suspense`), or a not-found view for an
unknown slug. Links are real `<a href>` elements; when `onNavigate` is given, plain
left-clicks are routed through it and modified clicks are left to the browser. It sets
`document.title` for the current view.

### Markdown posts

`markdownPost(source)` takes a string or a loader returning a string or a `?raw` module,
and returns a `load` function yielding a component that renders `<Markdown>`. The parser
starts from the engine's `markdownLite` (a tree of nodes rendered as React elements,
never an HTML string) and adds what prose posts need: blockquotes, images, horizontal
rules, and site-relative links. Links and images accept only `http(s):` URLs or paths
starting with a single `/`.

Call made here: the blog carries its own copy of the parser rather than making the
engine depend on the blog or moving the parser into `@cabn/world-schema`. The engine's
copy is tuned for release notes inside a HUD panel and is not exported. This avoids an
engine release; sharing one parser is a possible follow-up.

### Build output

`writeBlogPages({ blog, distDir, shellHtml? })`, called by the host after `vite build`:

- `dist/blog/index.html` and `dist/blog/<slug>/index.html`: the built `index.html` with
  `<title>` replaced and description, canonical, `og:*`, `twitter:card`,
  `article:published_time` and a feed `<link rel="alternate">` inserted before `</head>`.
  Everything else in the shell, including the CSP meta tag and script tags, is untouched.
  All inserted values are HTML-escaped.
- `dist/blog/feed.xml`: Atom, newest first, summary per entry, XML-escaped.
- `dist/blog/sitemap.xml`: the index and each post.
- Draft posts get a page (with `noindex`) but no feed or sitemap entry.

The host's static server must serve `/blog/<slug>/` from those files and fall back to
the SPA shell for unknown slugs. For the portfolio's Caddyfile that is a `try_files`
on `/blog*`.

### What the host supplies

The post modules, their assets and data, the `createBlog` call, one branch in its router,
a `writeBlogPages` call in its build, the server fallback rule, and
`import "@cabn/blog/styles.css"`.

### The old blog repo and blog world

Decided by the owner on 2026-11-22: the blog world goes away and every post lives in the
portfolio repo. The portfolio integration removes the `blog` entry from `projects.json`
and points the map's "Blog" cabin at `/blog`. The owner archives the
`SebastianFrazier26/blog` repo on GitHub themselves; its one placeholder post is not migrated.

## Testing

Vitest in `packages/blog/tests`, written before each module:

- post validation and `createBlog` (each rule, all problems reported together, ordering, drafts);
- `parseBlogRoute` (index, post, trailing slash, custom base path, non-blog paths, bad slugs);
- markdown parser (each block and inline kind, unsafe URLs become text, raw HTML stays text);
- React output through `react-dom/server` for the index, a standard post, a bare post,
  not-found and markdown rendering;
- feed, sitemap and page HTML (escaping, shell preserved, draft handling), and
  `writeBlogPages` against a temp directory;
- `findUnscopedSelectors` (scoped, unscoped, nested at-rules, comments, global at-rules);
- an import-graph test: no file under `src/` imports `@cabn/engine`, `phaser` or a
  browser-only module from the build entry.

A browser smoke test belongs with the portfolio integration, where a real page exists.

## Release

1. Merge the package PR. `@cabn/blog` is at 0.1.0 with no changeset needed for a first version.
2. Owner publishes 0.1.0 once by hand, then attaches the trusted publisher. Later
   versions go through `release.yml` like the other packages.
3. Portfolio PR: add the dependency, mount the blog, call `writeBlogPages`, add the
   Caddy rule, and move the fan-sentiment post in as a placeholder (its look is being redesigned).

## Left to the builder

File names inside `src/`, exact class names, the wording of the not-found view, and the
standard layout's spacing.
