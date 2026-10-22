import type {
	ShelfManifest,
	ShelfWorldEntry,
	Showcase,
	WorldManifest,
} from "@cabn/world-schema";
import { CABN_VERSION, validateShelf } from "@cabn/world-schema";

export interface ShelfWorldInput {
	name: string;
	worldUrl: string;
	manifest: WorldManifest;
	/** The world's parsed showcase.json: its title (when set) becomes the entry's name; description, links, order and the hero site's url ride along. */
	showcase?: Showcase;
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

function displayName(world: ShelfWorldInput): string {
	return world.showcase?.title ?? world.name;
}

/**
 * Shelf order: when any world sets showcase `order`, worlds sort by it
 * (lowest first, unset last) and then by name; with none set, the input
 * order is kept exactly as before `order` existed.
 */
export function orderShelfWorlds(
	worlds: readonly ShelfWorldInput[],
): ShelfWorldInput[] {
	if (!worlds.some((w) => w.showcase?.order !== undefined)) return [...worlds];
	return [...worlds].sort((a, b) => {
		const oa = a.showcase?.order ?? Number.POSITIVE_INFINITY;
		const ob = b.showcase?.order ?? Number.POSITIVE_INFINITY;
		if (oa !== ob) return oa < ob ? -1 : 1;
		const na = displayName(a);
		const nb = displayName(b);
		return na < nb ? -1 : na > nb ? 1 : 0;
	});
}

function heroUrl(world: ShelfWorldInput): string | undefined {
	const heroId = world.showcase?.heroPortalId;
	if (!heroId) return undefined;
	const preview = world.manifest.portals.find(
		(p) => p.id === heroId,
	)?.richPreview;
	return preview?.kind === "url" ? preview.url : undefined;
}

function entryFor(
	world: ShelfWorldInput,
	usedIds: Set<string>,
): ShelfWorldEntry {
	const name = displayName(world);
	const showcase = world.showcase;
	const hero = heroUrl(world);
	return {
		id: uniqueId(slug(name), usedIds),
		name,
		worldUrl: world.worldUrl,
		themeSeed: world.manifest.meta.themeSeed ?? 0,
		fileCount: world.manifest.meta.fileCount,
		totalBytes: world.manifest.meta.totalBytes,
		...(showcase?.description !== undefined
			? { description: showcase.description }
			: {}),
		...(showcase?.links.length ? { links: showcase.links } : {}),
		...(hero !== undefined ? { heroUrl: hero } : {}),
		...(showcase?.order !== undefined ? { order: showcase.order } : {}),
	};
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
		worlds: orderShelfWorlds(worlds).map((world) => entryFor(world, usedIds)),
	};
	return validateShelf(shelf);
}
