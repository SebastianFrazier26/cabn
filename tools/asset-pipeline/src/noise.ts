/**
 * Deterministic hash -> [0,1) noise, seeded by integer coordinates. Used
 * instead of Math.random() so soften() output is byte-identical across runs
 * given the same input and options (required for both reproducible builds
 * and the determinism test). Mulberry32-style mixing of (x, y, seed).
 */
export function hashNoise(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
	h = Math.imul(h ^ (h >>> 15), 2246822519);
	h = Math.imul(h ^ (h >>> 13), 3266489917);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Same noise, remapped to [-1, 1] — convenient for signed jitter/offsets. */
export function signedNoise(x: number, y: number, seed: number): number {
	return hashNoise(x, y, seed) * 2 - 1;
}
