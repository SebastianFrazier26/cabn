import type { ShelfManifest, WorldManifest } from "@cabn/world-schema";
import { CABN_VERSION, validateShelf } from "@cabn/world-schema";

export interface ShelfWorldInput {
	name: string;
	worldUrl: string;
	manifest: WorldManifest;
}

export interface BuildShelfOptions {
	/** Shelf display name (meta.name). Defaults to "My Worlds". */
	name?: string;
	/** Injectable clock for deterministic meta.generatedAt in tests. */
	now?: () => Date;
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Mirrors cluster.ts's uniqueId rationale: two worlds can slug to the same id
// ("My World" and "my-world"); first writer keeps the plain slug, later ones
// get a numeric suffix so shelf world ids stay stable without a rename pass.
function uniqueId(candidate: string, usedIds: Set<string>): string {
	const base = candidate || "world";
	if (!usedIds.has(base)) {
		usedIds.add(base);
		return base;
	}
	let n = 2;
	while (usedIds.has(`${base}-${n}`)) n++;
	const withSuffix = `${base}-${n}`;
	usedIds.add(withSuffix);
	return withSuffix;
}

/** Pure: builds a validated ShelfManifest listing a user's converted worlds for the hub/shelf scene. */
export function buildShelf(
	worlds: ShelfWorldInput[],
	opts: BuildShelfOptions = {},
): ShelfManifest {
	const usedIds = new Set<string>();
	const shelf: ShelfManifest = {
		cabnVersion: CABN_VERSION,
		meta: {
			name: opts.name ?? "My Worlds",
			generatedAt: (opts.now?.() ?? new Date()).toISOString(),
		},
		worlds: worlds.map((world) => ({
			id: uniqueId(slug(world.name), usedIds),
			name: world.name,
			worldUrl: world.worldUrl,
			themeSeed: world.manifest.meta.themeSeed ?? 0,
			fileCount: world.manifest.meta.fileCount,
			totalBytes: world.manifest.meta.totalBytes,
		})),
	};
	return validateShelf(shelf);
}
