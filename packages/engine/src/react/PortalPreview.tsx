import type {
	MarkdownPreviewNode,
	RichPortalPreview,
} from "@cabn/world-schema";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import { loadLanguageExtension } from "./editorLanguages.js";
import { pixelEditorExtensions } from "./editorTheme.js";

export interface PortalPreviewProps {
	/** undefined covers both "no richPreview on this manifest" (a pre-M10 bundle) and "portal has no override/content to show". */
	preview: RichPortalPreview | undefined;
	fileName: string;
	/** Base to resolve asset-relative paths (an image preview's `asset`) against — same convention as chunk/world URLs (see engine's resolveRelativeUrl). */
	worldBaseUrl: string;
	/**
	 * "overlay": compact, for a small in-world panel anchored near a portal —
	 * absolute positioning is the caller's job (this component has no notion
	 * of world position). "expanded": a larger, full-detail view — what
	 * PortalPreviewDock shows for the portal the player is standing at.
	 */
	variant: "overlay" | "expanded";
}

const OVERLAY_MAX_HEIGHT = 220;

function CodeBlock({
	code,
	language,
	maxHeight,
}: {
	code: string;
	language: string | undefined;
	maxHeight?: number;
}): React.ReactElement {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);

	useEffect(() => {
		if (!hostRef.current) return;
		let cancelled = false;

		loadLanguageExtension(language).then((languageExtension) => {
			if (cancelled || !hostRef.current) return;
			const state = EditorState.create({
				doc: code,
				extensions: [
					pixelEditorExtensions,
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					...(languageExtension ? [languageExtension] : []),
				],
			});
			viewRef.current = new EditorView({ state, parent: hostRef.current });
		});

		return () => {
			cancelled = true;
			viewRef.current?.destroy();
			viewRef.current = null;
		};
	}, [code, language]);

	return (
		<div
			ref={hostRef}
			style={{ height: "100%", maxHeight, overflow: "auto" }}
		/>
	);
}

function MarkdownNodeView({
	node,
}: {
	node: MarkdownPreviewNode;
}): React.ReactElement {
	switch (node.type) {
		case "heading": {
			const Tag =
				`h${Math.min(node.level, 6)}` as keyof React.JSX.IntrinsicElements;
			return <Tag style={{ margin: "0.4em 0" }}>{node.text}</Tag>;
		}
		case "paragraph":
			return <p style={{ margin: "0.4em 0" }}>{node.text}</p>;
		case "list": {
			const ListTag = node.ordered ? "ol" : "ul";
			return (
				<ListTag style={{ margin: "0.4em 0", paddingLeft: "1.4em" }}>
					{node.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ListTag>
			);
		}
		case "code":
			return (
				<pre
					style={{
						margin: "0.4em 0",
						padding: 8,
						overflow: "auto",
						background: "var(--cabn-panel-body-alt)",
						borderRadius: 6,
						fontFamily: "var(--cabn-font-mono)",
						fontSize: 12,
					}}
				>
					{node.text}
				</pre>
			);
	}
}

function SealedNotice(): React.ReactElement {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				opacity: 0.75,
				fontStyle: "italic",
			}}
		>
			Sealed — no preview available for this file.
		</div>
	);
}

/**
 * Renders one portal's richPreview payload (code with syntax colours,
 * rendered markdown from structured data — never raw HTML, so a malicious
 * README can't inject markup — an image, or a plain text blurb) in the flat
 * pixel-RPG UI style. Deliberately doesn't handle `kind: "url"` as a live
 * embed: that's PortalEmbed's job (a fundamentally different, network- and
 * security-sensitive rendering path). A url preview here falls back to the
 * same static title/link treatment PortalEmbed uses when it can't embed —
 * callers that want the live iframe render `<PortalEmbed>` instead of (or
 * layered over) this component.
 */
export function PortalPreview({
	preview,
	fileName,
	worldBaseUrl,
	variant,
}: PortalPreviewProps): React.ReactElement {
	const maxHeight = variant === "overlay" ? OVERLAY_MAX_HEIGHT : undefined;

	let body: React.ReactElement;
	if (!preview) {
		body = <SealedNotice />;
	} else {
		switch (preview.kind) {
			case "code":
				body = (
					<CodeBlock
						code={preview.lines.join("\n")}
						language={preview.language}
						maxHeight={maxHeight}
					/>
				);
				break;
			case "markdown":
				body = (
					<div style={{ overflow: "auto", maxHeight, padding: "0 4px" }}>
						{preview.nodes.map((node, i) => (
							// Structured preview nodes have no stable id of their own and are
							// never reordered/filtered after render — same fixed-list-index
							// rationale as RunOverlay's log entries.
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed, static list
							<MarkdownNodeView key={i} node={node} />
						))}
					</div>
				);
				break;
			case "image":
				body = (
					<img
						src={resolveRelativeUrl(worldBaseUrl, preview.asset)}
						alt={fileName}
						style={
							variant === "expanded"
								? {
										// Scaled up to fill the panel, not shown at natural size — a
										// small pixel-art asset (the demo's 48px logo) otherwise sits
										// as a postage stamp in a 440px panel.
										width: "100%",
										height: "100%",
										objectFit: "contain",
										imageRendering: "pixelated",
										display: "block",
									}
								: {
										maxWidth: "100%",
										maxHeight: maxHeight ?? "100%",
										objectFit: "contain",
										display: "block",
										margin: "0 auto",
									}
						}
					/>
				);
				break;
			case "text":
				body = (
					<p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{preview.text}</p>
				);
				break;
			case "url":
				body = (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 8,
							alignItems: "center",
						}}
					>
						<span>{preview.title ?? preview.url}</span>
						<a
							className="cabn-btn neutral"
							href={preview.url}
							target="_blank"
							rel="noopener noreferrer"
							style={{ textDecoration: "none" }}
						>
							Open in new tab
						</a>
					</div>
				);
				break;
			case "sealed":
				body = <SealedNotice />;
				break;
		}
	}

	return (
		<div
			className="cabn-panel"
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				padding: variant === "overlay" ? 6 : 14,
				overflow: "hidden",
			}}
		>
			{variant === "expanded" && (
				<div className="cabn-panel-title" style={{ marginBottom: 6 }}>
					{fileName}
				</div>
			)}
			<div style={{ flex: 1, minHeight: 0 }}>{body}</div>
		</div>
	);
}
