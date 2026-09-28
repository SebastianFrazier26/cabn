/**
 * Deterministic PRNG/hash utilities shared by the world-art placement logic
 * (ground-tile variant choice, scatter placement, path-stamp jitter) — one
 * copy within @cabn/engine, unlike theme.ts's mulberry32 (deliberately
 * duplicated from @cabn/converter to avoid a cross-package dependency for
 * ~10 lines): these three call sites all live in this package already.
 */
export function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Folds a string (a cluster/portal id) into a uint32 seed for mulberry32 — FNV-1a, chosen for being tiny and dependency-free, not for cryptographic properties this has no need of. */
export function hashStringSeed(str: string): number {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Deterministic [0,1) noise from two integer coords + a seed — same shape as
 * tools/asset-pipeline's hashNoise (kept as a separate copy since engine
 * doesn't depend on that private tool package). Used where a *position*
 * needs a stable pseudo-random value (e.g. "which grass variant does the
 * tile at grid cell (3, 7) use") rather than a *sequence* (mulberry32).
 */
export function hashNoise2D(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
	h = Math.imul(h ^ (h >>> 15), 2246822519);
	h = Math.imul(h ^ (h >>> 13), 3266489917);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
