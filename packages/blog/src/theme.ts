/**
 * Every value the blog's stylesheet reads. Each is a CSS custom property,
 * `--cabn-blog-<kebab-name>`, with its default in styles.css; a site
 * overrides any of them through `createBlog({ theme })` or its own stylesheet.
 * tests/theme.test.tsx keeps this list and the stylesheet in step.
 */
export const BLOG_THEME_TOKENS = [
	"page",
	"pageBand",
	"panel",
	"panelAlt",
	"border",
	"highlight",
	"text",
	"textSoft",
	"link",
	"linkHover",
	"accent",
	"accentInk",
	"quote",
	"code",
	"shadow",
	"fontDisplay",
	"fontProse",
	"fontMono",
	"fontSize",
	"width",
	"pad",
	"gap",
	"radius",
	"borderWidth",
] as const;

export type BlogThemeToken = (typeof BLOG_THEME_TOKENS)[number];

export type BlogScheme = "auto" | "light" | "dark";

export interface BlogTheme {
	/** `"auto"` (default) follows the reader's system setting; the others pin the built-in light or dark set. */
	scheme?: BlogScheme;
	/** Overrides for any token, as CSS values. They apply in both schemes. */
	tokens?: Partial<Record<BlogThemeToken, string>>;
	/** Extra class names for the blog's root element, for a site stylesheet to hook. */
	className?: string;
}

export interface ResolvedBlogTheme {
	readonly scheme: BlogScheme;
	readonly tokens: Readonly<Partial<Record<BlogThemeToken, string>>>;
	readonly className?: string;
}

export function tokenProperty(token: BlogThemeToken): string {
	return `--cabn-blog-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** Inline custom properties for the root element, or undefined when there are none to set. */
export function themeStyle(
	tokens: Partial<Record<BlogThemeToken, string>> | undefined,
): Record<string, string> | undefined {
	const entries = Object.entries(tokens ?? {}).map(
		([token, value]) =>
			[tokenProperty(token as BlogThemeToken), value] as const,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const SCHEMES: readonly string[] = ["auto", "light", "dark"];

export function themeProblems(theme: BlogTheme): string[] {
	const found: string[] = [];
	if (theme.scheme !== undefined && !SCHEMES.includes(theme.scheme)) {
		found.push('theme.scheme must be "auto", "light" or "dark"');
	}
	if (
		theme.className !== undefined &&
		!/^[A-Za-z_][\w-]*(?: [A-Za-z_][\w-]*)*$/.test(theme.className)
	) {
		found.push(
			"theme.className must be class names separated by single spaces",
		);
	}
	const known: readonly string[] = BLOG_THEME_TOKENS;
	for (const [token, value] of Object.entries(theme.tokens ?? {})) {
		if (!known.includes(token)) {
			found.push(`theme.tokens.${token} is not a theme token`);
			continue;
		}
		// One declaration's worth of value: nothing that could close it and
		// start another rule if a host ever serialises the theme into a stylesheet.
		if (
			typeof value !== "string" ||
			value.trim() === "" ||
			value.length > 300 ||
			/[;{}<>]/.test(value)
		) {
			found.push(`theme.tokens.${token} must be a single CSS value`);
		}
	}
	return found;
}

export function resolveTheme(theme: BlogTheme | undefined): ResolvedBlogTheme {
	return {
		scheme: theme?.scheme ?? "auto",
		tokens: { ...theme?.tokens },
		...(theme?.className === undefined ? {} : { className: theme.className }),
	};
}
