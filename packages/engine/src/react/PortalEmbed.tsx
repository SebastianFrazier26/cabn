import { useEffect, useRef, useState } from "react";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import { canOpenPortalLink, shouldMountEmbed } from "../systems/embedGuard.js";

export interface PortalEmbedProps {
	/** The url preview's target — already schema-checked as https:// at convert time, re-checked against allowedEmbedOrigins below regardless. */
	url: string;
	title?: string;
	/** Bundle-relative path (world.json's `preview.fallbackImage`), shown instead of the iframe when embedding isn't possible. */
	fallbackImage?: string;
	/** The manifest's own allowedEmbedOrigins — re-checked here at render time, not trusted from whatever already validated cabn.json at build time. */
	allowedEmbedOrigins: readonly string[];
	/** Base to resolve `fallbackImage` against — same convention as chunk/world URLs (see engine's resolveRelativeUrl). */
	worldBaseUrl: string;
	/** Caller decides when a portal is "open or approached enough" (a future WorldScene integration — this component has no notion of world position). False unmounts the iframe entirely rather than just hiding it. */
	active: boolean;
	loadTimeoutMs?: number;
}

const DEFAULT_LOAD_TIMEOUT_MS = 6000;

function FallbackCard({
	url,
	title,
	fallbackImageUrl,
	allowedEmbedOrigins,
}: {
	url: string;
	title: string | undefined;
	fallbackImageUrl: string | undefined;
	allowedEmbedOrigins: readonly string[];
}): React.ReactElement {
	// The card also shows when the origin check failed, so the link gets the
	// same allowlist check as every other portal link (no javascript: hrefs).
	const canOpen = canOpenPortalLink(url, allowedEmbedOrigins);
	return (
		<div
			className="cabn-panel"
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 10,
				width: "100%",
				height: "100%",
				textAlign: "center",
			}}
		>
			{fallbackImageUrl && (
				<img
					src={fallbackImageUrl}
					alt=""
					style={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain" }}
				/>
			)}
			<span>{title ?? url}</span>
			{canOpen && (
				<a
					className="cabn-btn neutral"
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					style={{ textDecoration: "none" }}
				>
					Open in new tab
				</a>
			)}
		</div>
	);
}

/**
 * The live sandboxed embed for a "url" richPreview. Renders nothing at all
 * when `active` is false (the caller — a future WorldScene integration —
 * only flips this once the player has actually opened/approached the
 * portal) or when the origin re-check fails; falls back to a static
 * title/link card when the iframe fails or times out, since many hosts send
 * X-Frame-Options/CSP frame-ancestors that make embedding impossible and
 * give no reliable cross-origin signal back to this page (see the load
 * effect below).
 *
 * Sandbox flags, reasoned individually rather than copied wholesale:
 * - allow-scripts: without it most real sites (a portfolio, a demo) are
 *   inert — the whole feature is pointless without this.
 * - allow-same-origin: kept. The framed page is always a *different* origin
 *   than the host (shouldMountEmbed refuses the page's own origin even when
 *   the allowlist names it), so this mainly restores the framed site's own cookies/
 *   localStorage/session, which most real sites need to render or function
 *   at all. The classic "allow-same-origin defeats the sandbox" escape
 *   requires the framed content to *be* (or navigate into) the same origin
 *   as the embedding page, which never applies here.
 * - allow-forms: kept. Dropping it breaks any embedded search box/contact
 *   form; a form can only submit to the framed page's own target, and
 *   allow-top-navigation is never granted, so it can't hijack this page.
 * - allow-popups + allow-popups-to-escape-sandbox: kept, for ordinary
 *   target="_blank" links on the embedded page — the resulting popup is a
 *   brand-new top-level context, not a way back into this page.
 * - allow-top-navigation: never granted, under any circumstance — this is
 *   the one flag that would let the framed page redirect the cabn world UI
 *   itself.
 *
 * referrerPolicy="no-referrer" (don't leak the host page's URL to the framed
 * origin), loading="lazy", and allow="" (no camera/mic/geolocation/etc. —
 * every Permissions-Policy feature stays denied) round out the hardening.
 *
 * Hosting note: a page embedding this component needs a CSP `frame-src`
 * naming exactly its bundle's allowedEmbedOrigins (see README).
 */
export function PortalEmbed({
	url,
	title,
	fallbackImage,
	allowedEmbedOrigins,
	worldBaseUrl,
	active,
	loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
}: PortalEmbedProps): React.ReactElement | null {
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const canEmbed = shouldMountEmbed(url, allowedEmbedOrigins, active);

	// `url` isn't read inside the effect body below, but must stay a
	// dependency: without it, navigating between two allowed origins
	// (canEmbed true both times) wouldn't reset loaded/failed or restart the
	// timeout for the new url.
	// biome-ignore lint/correctness/useExhaustiveDependencies: url intentionally forces a re-run it wouldn't otherwise trigger
	useEffect(() => {
		setLoaded(false);
		setFailed(false);
		if (!canEmbed) return undefined;

		// Cross-origin means this page can never inspect what actually rendered
		// inside the frame, and a host that refuses to be framed often still
		// fires `load` on the resulting blank/error document — a timeout is the
		// honest, standard-practice heuristic here, not a precise success signal.
		// It does NOT catch X-Frame-Options/frame-ancestors refusals: Chrome
		// loads its own error page into the frame and fires `load` promptly,
		// which clears this timeout. There's no reliable cross-origin signal
		// for that case (no error event, contentDocument is null either way,
		// frame-ancestors violations are reported to the framed site, not
		// here), so it's decided at build time instead — embeds.json, see
		// converter/embedCheck.ts — and a known-blocked site never reaches
		// this component.
		const timeout = setTimeout(() => setFailed(true), loadTimeoutMs);
		timeoutRef.current = timeout;
		return () => clearTimeout(timeout);
	}, [canEmbed, url, loadTimeoutMs]);

	if (!active) return null;

	const fallbackImageUrl = fallbackImage
		? resolveRelativeUrl(worldBaseUrl, fallbackImage)
		: undefined;

	if (!canEmbed || failed) {
		return (
			<FallbackCard
				url={url}
				title={title}
				fallbackImageUrl={fallbackImageUrl}
				allowedEmbedOrigins={allowedEmbedOrigins}
			/>
		);
	}

	const handleLoad = () => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		setLoaded(true);
	};
	const handleError = () => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current);
		setFailed(true);
	};

	return (
		<div
			className="cabn-panel"
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				padding: 0,
				overflow: "hidden",
			}}
		>
			{!loaded && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					Loading preview…
				</div>
			)}
			<iframe
				key={url}
				src={url}
				title={title ?? url}
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
				referrerPolicy="no-referrer"
				loading="lazy"
				allow=""
				onLoad={handleLoad}
				onError={handleError}
				style={{
					width: "100%",
					height: "100%",
					border: "none",
					opacity: loaded ? 1 : 0,
				}}
			/>
		</div>
	);
}
