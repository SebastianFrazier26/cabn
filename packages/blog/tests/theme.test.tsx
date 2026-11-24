import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { describe, expect, it } from "vitest";
import { Blog } from "../src/Blog.js";
import { markdownPost } from "../src/Markdown.js";
import {
	BlogConfigError,
	type BlogTheme,
	createBlog,
	definePost,
} from "../src/post.js";
import { BLOG_THEME_TOKENS, themeStyle, tokenProperty } from "../src/theme.js";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

async function render(element: ReactElement): Promise<string> {
	const stream = await renderToReadableStream(element);
	await stream.allReady;
	return new Response(stream).text();
}

function site(theme?: BlogTheme) {
	return createBlog({
		title: "Notes",
		description: "D",
		siteUrl: "https://example.com",
		...(theme ? { theme } : {}),
		posts: [
			definePost({
				slug: "a",
				title: "A",
				date: "2026-01-01",
				summary: "S",
				load: markdownPost("Body."),
			}),
			definePost({
				slug: "own",
				title: "Own",
				date: "2026-01-02",
				summary: "S",
				layout: "bare",
				load: async () => ({ default: () => <main className="own">x</main> }),
			}),
		],
	});
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
	const at = css.indexOf(`${selector} {`);
	expect(at, selector).toBeGreaterThan(-1);
	return css.slice(at, css.indexOf("}", at));
}

describe("theme tokens", () => {
	it("maps camelCase names to --cabn-blog-* properties", () => {
		expect(tokenProperty("panel")).toBe("--cabn-blog-panel");
		expect(tokenProperty("textSoft")).toBe("--cabn-blog-text-soft");
		expect(tokenProperty("fontDisplay")).toBe("--cabn-blog-font-display");
	});

	it("gives every token a default in the stylesheet", () => {
		const defaults = ruleBody(":where(.cabn-blog)");
		for (const token of BLOG_THEME_TOKENS) {
			expect(defaults, token).toContain(`${tokenProperty(token)}:`);
		}
	});

	it("lists every custom property the stylesheet uses", () => {
		const known = new Set(BLOG_THEME_TOKENS.map(tokenProperty));
		const used = new Set(css.match(/--cabn-blog-[a-z-]+/g));
		expect([...used].filter((name) => !known.has(name))).toEqual([]);
	});

	// A site rule as plain as `.cabn-blog { --cabn-blog-panel: … }` has to win
	// whatever order the stylesheets load in, and in dark mode too. :where()
	// has zero specificity, so it does.
	it("declares defaults only at zero specificity", () => {
		const declaring = [
			...css
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.matchAll(/([^{}]+)\{[^{}]*--cabn-blog-[a-z-]+\s*:/g),
		]
			.map((match) => (match[1] as string).trim())
			.filter((selector) => !selector.startsWith("@"));
		expect(declaring.length).toBeGreaterThanOrEqual(3);
		for (const selector of declaring) {
			expect(selector).toMatch(/^:where\(.*\)$/);
		}
	});

	it("has a dark set for the system setting and for a forced scheme", () => {
		expect(css).toContain("@media (prefers-color-scheme: dark)");
		expect(css).toContain(
			':where(.cabn-blog:not([data-cabn-blog-scheme="light"]))',
		);
		expect(css).toContain(':where(.cabn-blog[data-cabn-blog-scheme="dark"])');
	});
});

describe("themeStyle", () => {
	it("turns tokens into custom properties", () => {
		expect(
			themeStyle({ panel: "#fff", fontDisplay: '"Scorebug", sans-serif' }),
		).toEqual({
			"--cabn-blog-panel": "#fff",
			"--cabn-blog-font-display": '"Scorebug", sans-serif',
		});
		expect(themeStyle(undefined)).toBeUndefined();
		expect(themeStyle({})).toBeUndefined();
	});
});

describe("createBlog theme", () => {
	it("rejects unknown tokens, unsafe values and unknown schemes", () => {
		try {
			site({
				tokens: { panle: "#fff", text: "red; } body { display: none" } as never,
				scheme: "sepia" as never,
				className: "a b<",
			});
		} catch (error) {
			expect(error).toBeInstanceOf(BlogConfigError);
			const problems = (error as BlogConfigError).problems;
			expect(problems).toHaveLength(4);
			expect(problems.join("\n")).toMatch(/panle/);
			return;
		}
		throw new Error("expected a BlogConfigError");
	});

	it("defaults to following the system scheme with no overrides", () => {
		expect(site().theme).toEqual({ scheme: "auto", tokens: {} });
	});
});

describe("<Blog> with a theme", () => {
	const themed = site({
		scheme: "dark",
		className: "my-blog",
		tokens: { panel: "#101010", width: "60rem" },
	});

	it.each([
		["index", { kind: "index" }],
		["post", { kind: "post", slug: "a" }],
		["not-found", { kind: "post", slug: "zzz" }],
	] as const)("applies it on the %s root", async (_name, route) => {
		const html = await render(<Blog blog={themed} route={route} />);
		const root = /<main[^>]*>/.exec(html)?.[0] ?? "";
		expect(root).toContain("my-blog");
		expect(root).toContain('data-cabn-blog-scheme="dark"');
		expect(root).toContain("--cabn-blog-panel:#101010");
		expect(root).toContain("--cabn-blog-width:60rem");
	});

	it("adds nothing when there is no theme", async () => {
		const html = await render(<Blog blog={site()} route={{ kind: "index" }} />);
		const root = /<main[^>]*>/.exec(html)?.[0] ?? "";
		expect(root).not.toContain("style=");
		expect(root).not.toContain("data-cabn-blog-scheme");
	});

	it("leaves a bare post entirely alone", async () => {
		const html = await render(
			<Blog blog={themed} route={{ kind: "post", slug: "own" }} />,
		);
		expect(html).toContain('<main class="own">x</main>');
		expect(html).not.toContain("cabn-blog");
		expect(html).not.toContain("my-blog");
	});
});
