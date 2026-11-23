import type { ReactElement } from "react";
import { BlogLink } from "./BlogLink.js";
import { type MdInline, parseMarkdown } from "./parseMarkdown.js";
import type { PostLoader } from "./post.js";

type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";

/** Markdown as React elements, never HTML. */
export function Markdown({ source }: { source: string }): ReactElement {
	return (
		<div className="cabn-blog-md">
			{parseMarkdown(source).map((block, i) => {
				const key = `${block.kind}-${i}`;
				switch (block.kind) {
					case "heading": {
						// One level down: the page's h1 is the post title.
						const Tag = `h${Math.min(block.level + 1, 6)}` as HeadingTag;
						return (
							<Tag key={key}>
								<Inline nodes={block.inline} />
							</Tag>
						);
					}
					case "paragraph":
						return (
							<p key={key}>
								<Inline nodes={block.inline} />
							</p>
						);
					case "list": {
						const items = block.items.map((item, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static parsed list, never reordered.
							<li key={j}>
								<Inline nodes={item} />
							</li>
						));
						return block.ordered ? (
							<ol key={key}>{items}</ol>
						) : (
							<ul key={key}>{items}</ul>
						);
					}
					case "quote":
						return (
							<blockquote key={key}>
								{block.paragraphs.map((paragraph, j) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: static parsed list, never reordered.
									<p key={j}>
										<Inline nodes={paragraph} />
									</p>
								))}
							</blockquote>
						);
					case "image":
						return (
							<img key={key} src={block.src} alt={block.alt} loading="lazy" />
						);
					case "rule":
						return <hr key={key} />;
					case "code":
						return (
							<pre key={key}>
								<code
									className={block.lang ? `language-${block.lang}` : undefined}
								>
									{block.text}
								</code>
							</pre>
						);
				}
				return null;
			})}
		</div>
	);
}

function Inline({ nodes }: { nodes: MdInline[] }): ReactElement {
	return (
		<>
			{nodes.map((node, i) => {
				const key = `${node.kind}-${i}`;
				switch (node.kind) {
					case "text":
						return node.text;
					case "code":
						return <code key={key}>{node.text}</code>;
					case "strong":
						return (
							<strong key={key}>
								<Inline nodes={node.children} />
							</strong>
						);
					case "em":
						return (
							<em key={key}>
								<Inline nodes={node.children} />
							</em>
						);
					case "link":
						return node.external ? (
							<a
								key={key}
								href={node.href}
								target="_blank"
								rel="noopener noreferrer"
							>
								{node.text}
							</a>
						) : (
							<BlogLink key={key} href={node.href}>
								{node.text}
							</BlogLink>
						);
				}
				return null;
			})}
		</>
	);
}

export type MarkdownSource =
	| string
	| (() => Promise<string | { default: string }>);

/**
 * A post's `load` for a prose-only post. Pass the text, or a lazy loader such
 * as `() => import("./hello.md?raw")` so the text is its own chunk.
 */
export function markdownPost(source: MarkdownSource): PostLoader {
	return async () => {
		const loaded = typeof source === "string" ? source : await source();
		const text = typeof loaded === "string" ? loaded : loaded.default;
		return {
			default: function MarkdownPost() {
				return <Markdown source={text} />;
			},
		};
	};
}
