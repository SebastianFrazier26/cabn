/**
 * Resolves a shelf entry's worldUrl (or any manifest-relative path) against
 * the base directory the manifest itself was fetched from. `cabn shelf`
 * writes bundle-relative paths ("sample/world.json"); a hand-authored or
 * root-hosted shelf may use absolute ones ("/worlds/sample/world.json") —
 * both need to resolve correctly without the caller knowing which it got.
 */
export function resolveRelativeUrl(base: string, url: string): string {
	return url.startsWith("/") ? url : `${base}${url}`;
}
