import { type MdInline, parseMarkdownLite } from "../systems/markdownLite.js";

/** Release notes as React elements (never HTML): links open in a new tab without an opener. */
export function MarkdownLite({
	source,
}: {
	source: string;
}): React.ReactElement {
	const blocks = parseMarkdownLite(source);
	return (
		<div className="cabn-md-lite" style={{ fontSize: 12, lineHeight: 1.45 }}>
			{blocks.map((block, i) => {
				const key = `${block.kind}-${i}`;
				if (block.kind === "heading") {
					return (
						// One fixed level: release notes sit inside the picker's own heading structure.
						<h4
							key={key}
							style={{
								fontWeight: 700,
								margin: "8px 0 4px",
								fontSize: block.level <= 2 ? 13 : 12,
							}}
						>
							<Inline nodes={block.inline} />
						</h4>
					);
				}
				if (block.kind === "code") {
					return (
						<pre
							key={key}
							style={{
								fontFamily: "var(--cabn-font-mono)",
								background: "var(--cabn-inset-tint)",
								padding: 6,
								borderRadius: 6,
								overflowX: "auto",
								margin: "4px 0",
							}}
						>
							{block.text}
						</pre>
					);
				}
				if (block.kind === "list") {
					const items = block.items.map((item, j) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static parsed list, never reordered.
						<li key={j}>
							<Inline nodes={item} />
						</li>
					));
					return block.ordered ? (
						<ol key={key} style={{ margin: "4px 0", paddingLeft: 20 }}>
							{items}
						</ol>
					) : (
						<ul key={key} style={{ margin: "4px 0", paddingLeft: 20 }}>
							{items}
						</ul>
					);
				}
				return (
					<p key={key} style={{ margin: "4px 0" }}>
						<Inline nodes={block.inline} />
					</p>
				);
			})}
		</div>
	);
}

function Inline({ nodes }: { nodes: MdInline[] }): React.ReactElement {
	return (
		<>
			{nodes.map((node, i) => {
				const key = `${node.kind}-${i}`;
				switch (node.kind) {
					case "text":
						return <span key={key}>{node.text}</span>;
					case "code":
						return (
							<code
								key={key}
								style={{
									fontFamily: "var(--cabn-font-mono)",
									background: "var(--cabn-inset-tint)",
									padding: "0 3px",
									borderRadius: 3,
								}}
							>
								{node.text}
							</code>
						);
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
						return (
							<a
								key={key}
								href={node.href}
								target="_blank"
								rel="noopener noreferrer"
								style={{ color: "var(--cabn-syntax-function)" }}
							>
								{node.text}
							</a>
						);
				}
				return null;
			})}
		</>
	);
}
