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
