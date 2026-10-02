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

// Keep the key identical to the engine's computeScenerySeed
// (packages/engine/src/systems/save.ts) so a world's tint and scenery move
// together: both change only when its name or file tree does, never with the
// absolute source path or the build time.
export function worldTreeSeed(manifest: {
	meta: { name: string };
	clusters: readonly { path: string }[];
	portals: readonly { file: { path: string } }[];
}): number {
	const clusterPaths = manifest.clusters.map((c) => c.path).sort();
	const filePaths = manifest.portals.map((p) => p.file.path).sort();
	return fnv1a(
		`${manifest.meta.name}\u0000${clusterPaths.join("\n")}\u0000${filePaths.join("\n")}`,
	);
}
