import { escapeMarkup } from "./escape.js";

export interface PageMeta {
	title: string;
	description: string;
	/** Canonical absolute URL. */
	url: string;
	siteName: string;
	feedUrl: string;
	type: "website" | "article";
	/** Absolute URL. */
	image?: string;
	publishedTime?: string;
	modifiedTime?: string;
	noindex?: boolean;
}

/**
 * The app's built `index.html` with one page's title and link-preview tags
 * filled in. The body is untouched: the app still renders the page in the
 * browser. Only `<title>` and `<meta name="description">` are replaced;
 * nothing else in the shell (its CSP meta, its scripts) is moved or changed.
 */
export function renderPageHtml(shellHtml: string, meta: PageMeta): string {
	if (!/<\/head>/i.test(shellHtml)) {
		throw new Error("the shell HTML has no </head> to add page tags before");
	}
	const tags = [
		`<meta name="description" content="${escapeMarkup(meta.description)}" />`,
		`<link rel="canonical" href="${escapeMarkup(meta.url)}" />`,
		`<meta property="og:type" content="${meta.type}" />`,
		`<meta property="og:title" content="${escapeMarkup(meta.title)}" />`,
		`<meta property="og:description" content="${escapeMarkup(meta.description)}" />`,
		`<meta property="og:url" content="${escapeMarkup(meta.url)}" />`,
		`<meta property="og:site_name" content="${escapeMarkup(meta.siteName)}" />`,
	];
	if (meta.image !== undefined) {
		tags.push(
			`<meta property="og:image" content="${escapeMarkup(meta.image)}" />`,
		);
	}
	if (meta.publishedTime !== undefined) {
		tags.push(
			`<meta property="article:published_time" content="${escapeMarkup(meta.publishedTime)}" />`,
		);
	}
	if (meta.modifiedTime !== undefined) {
		tags.push(
			`<meta property="article:modified_time" content="${escapeMarkup(meta.modifiedTime)}" />`,
		);
	}
	tags.push(
		`<meta name="twitter:card" content="${meta.image === undefined ? "summary" : "summary_large_image"}" />`,
		`<link rel="alternate" type="application/atom+xml" href="${escapeMarkup(meta.feedUrl)}" />`,
	);
	if (meta.noindex) tags.push('<meta name="robots" content="noindex" />');

	const title = `<title>${escapeMarkup(meta.title)}</title>`;
	let html = shellHtml.replace(
		/[ \t]*<meta\s+name=["']description["'][^>]*>\s*?\n?/gi,
		"",
	);
	// Function replacers throughout: a title or summary holding "$1" or "$&"
	// would otherwise be read as a replacement pattern.
	if (/<title>[\s\S]*?<\/title>/i.test(html)) {
		html = html.replace(/<title>[\s\S]*?<\/title>/i, () => title);
	} else {
		tags.unshift(title);
	}
	const indent = /\n([ \t]*)<\/head>/i.exec(html)?.[1] ?? "";
	const block = tags.map((tag) => `${indent}\t${tag}\n`).join("");
	return html.replace(/([ \t]*)<\/head>/i, (close) => `${block}${close}`);
}
