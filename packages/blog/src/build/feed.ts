import type { Blog } from "../post.js";
import { escapeMarkup } from "./escape.js";
import { feedUrl, indexUrl, lastChanged, postUrl } from "./urls.js";

function atomTime(day: string): string {
	return `${day}T00:00:00Z`;
}

/** An Atom 1.0 feed of the published posts, newest first, one summary each. */
export function renderAtomFeed(blog: Blog): string {
	// Dated by content, never by build time: an unchanged blog must produce
	// an identical file, or every deploy would look like an update to readers.
	const updated = blog.posts
		.map(lastChanged)
		.reduce((latest, day) => (day > latest ? day : latest), "1970-01-01");
	const lines = [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<feed xmlns="http://www.w3.org/2005/Atom">',
		`\t<title>${escapeMarkup(blog.title)}</title>`,
		`\t<subtitle>${escapeMarkup(blog.description)}</subtitle>`,
		`\t<updated>${atomTime(updated)}</updated>`,
		`\t<id>${escapeMarkup(indexUrl(blog))}</id>`,
		`\t<link rel="alternate" type="text/html" href="${escapeMarkup(indexUrl(blog))}"/>`,
		`\t<link rel="self" type="application/atom+xml" href="${escapeMarkup(feedUrl(blog))}"/>`,
		`\t<author><name>${escapeMarkup(blog.author ?? blog.title)}</name></author>`,
	];
	for (const post of blog.posts) {
		const url = escapeMarkup(postUrl(blog, post));
		lines.push(
			"\t<entry>",
			`\t\t<title>${escapeMarkup(post.title)}</title>`,
			`\t\t<id>${url}</id>`,
			`\t\t<link rel="alternate" type="text/html" href="${url}"/>`,
			`\t\t<published>${atomTime(post.date)}</published>`,
			`\t\t<updated>${atomTime(lastChanged(post))}</updated>`,
			`\t\t<summary>${escapeMarkup(post.summary)}</summary>`,
			"\t</entry>",
		);
	}
	lines.push("</feed>", "");
	return lines.join("\n");
}
