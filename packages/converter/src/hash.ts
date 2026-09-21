// FNV-1a — cheap, deterministic, good enough distribution for both PRNG
// jitter seeding (layout.ts) and short collision-breaking id suffixes
// (cluster.ts). Not cryptographic; nothing here needs it to be.
export function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function shortHash(str: string, length = 6): string {
	return fnv1a(str).toString(16).padStart(8, "0").slice(0, length);
}
