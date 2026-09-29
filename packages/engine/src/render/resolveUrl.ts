/**
 * Resolves a shelf entry's worldUrl (or any manifest-relative path) against
 * the base directory the manifest itself was fetched from. `cabn shelf`
 * writes bundle-relative paths ("sample/world.json"); a hand-authored or
 * root-hosted shelf may use absolute ones ("/worlds/sample/world.json") —
 * both need to resolve correctly without the caller knowing which it got.
 *
 * A world converted in the browser (a git universe) has no server behind
 * it: its bundle lives in memory under a `cabn-mem:<key>/` base, and each
 * file resolves to a blob: URL made on first use, so every loader that
 * already goes through here (manifest, sidecars, chunks, media, search
 * index) works on it unchanged.
 */
export const MEMORY_WORLD_PREFIX = "cabn-mem:";

const memoryWorlds = new Map<string, Map<string, Uint8Array | string>>();
const blobUrls = new Map<string, string>();

const CONTENT_TYPES: Record<string, string> = {
	json: "application/json",
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	pdf: "application/pdf",
};

/** Registers (or replaces) an in-memory bundle; returns the world base to boot it from. */
export function registerMemoryWorld(
	key: string,
	bundle: Map<string, Uint8Array | string>,
): string {
	const base = `${MEMORY_WORLD_PREFIX}${key}/`;
	for (const [url, blob] of blobUrls) {
		if (url.startsWith(base)) {
			URL.revokeObjectURL(blob);
			blobUrls.delete(url);
		}
	}
	memoryWorlds.set(key, bundle);
	return base;
}

/** A full world url -> something fetch/XHR/<img> can load; non-memory urls pass through. */
export function resolveBundleUrl(url: string): string {
	if (!url.startsWith(MEMORY_WORLD_PREFIX)) return url;
	const cached = blobUrls.get(url);
	if (cached) return cached;
	const rest = url.slice(MEMORY_WORLD_PREFIX.length);
	const slash = rest.indexOf("/");
	const bundle = memoryWorlds.get(rest.slice(0, slash));
	const value = bundle?.get(rest.slice(slash + 1));
	// A missing entry must still fail like a 404 would, not fall through to some other origin.
	if (value === undefined) return "data:,";
	const ext = url.slice(url.lastIndexOf(".") + 1).toLowerCase();
	const blob = new Blob([value as BlobPart], {
		type: CONTENT_TYPES[ext] ?? "application/octet-stream",
	});
	const made = URL.createObjectURL(blob);
	blobUrls.set(url, made);
	return made;
}

export function resolveRelativeUrl(base: string, url: string): string {
	return resolveBundleUrl(url.startsWith("/") ? url : `${base}${url}`);
}
