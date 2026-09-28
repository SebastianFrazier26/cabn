import { isAllowedEmbedOrigin } from "@cabn/world-schema";

/**
 * The runtime gate PortalEmbed (react/PortalEmbed.tsx) renders behind —
 * standalone here (not inlined into the component) so it's unit-testable
 * without mounting React, and so it's the *one* place this decision gets
 * made, independent of whatever cabn.json validation already happened at
 * convert time: by render time, `url`/`allowedEmbedOrigins` are just fields
 * off a fetched world.json, same as any other untrusted input. `active`
 * folds in here too — an inert (not-yet-approached) portal never even
 * evaluates as embeddable.
 */
export function shouldMountEmbed(
	url: string,
	allowedEmbedOrigins: readonly string[],
	active: boolean,
): boolean {
	return active && isAllowedEmbedOrigin(url, allowedEmbedOrigins);
}

/**
 * Whether a url preview may be opened in the player's browser (clicking the
 * in-arch mini-page, the canvas title card, or the dock's button). Same bar
 * as framing it — https and on the manifest's allowlist — rather than a
 * looser "any https link": world.json is untrusted input, and the allowlist
 * is the only thing that says the bundle's author vouched for this origin.
 */
export function canOpenPortalLink(
	url: string,
	allowedEmbedOrigins: readonly string[],
): boolean {
	return isAllowedEmbedOrigin(url, allowedEmbedOrigins);
}

export type WindowOpen = (
	url: string,
	target: string,
	features: string,
) => unknown;

/** Returns whether it opened. `open` is injectable for tests; noopener,noreferrer keeps the new tab from reaching back into (or learning the url of) the game page. */
export function openPortalLink(
	url: string,
	allowedEmbedOrigins: readonly string[],
	open: WindowOpen | undefined = typeof window === "undefined"
		? undefined
		: window.open.bind(window),
): boolean {
	if (!open || !canOpenPortalLink(url, allowedEmbedOrigins)) return false;
	open(url, "_blank", "noopener,noreferrer");
	return true;
}
