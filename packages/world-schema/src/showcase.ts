import { z } from "zod";
import {
	WORLD_DESCRIPTION_MAX_CHARS,
	WorldInfoConfigSchema,
	WorldLinkSchema,
} from "./cabnConfig.js";

/**
 * cabn.json's `world` info and `sites` ship in their own `showcase.json`, for
 * the reason media.json and embeds.json do: world.json is parsed strictly by
 * every engine ever shipped, so a new field there would make an older engine
 * reject the whole world. The site portals themselves are ordinary portals
 * in world.json (url richPreview, SITE_PORTAL_PREFIX ids), which every engine
 * already renders; this file only adds what an older engine can do without
 * (which one is the hero, the world's title and description). Always written,
 * like media.json, so an engine can fetch it unconditionally.
 */
export const SHOWCASE_VERSION = 1;
export const SHOWCASE_FILENAME = "showcase.json";

/** Portal id prefix for a cabn.json site. A real file at the same path fails the conversion rather than being shadowed. */
export const SITE_PORTAL_PREFIX = "@cabn-site/";

export function sitePortalId(siteId: string): string {
	return `${SITE_PORTAL_PREFIX}${siteId}`;
}

export const ShowcaseSiteSchema = z.strictObject({
	portalId: z.string().startsWith(SITE_PORTAL_PREFIX),
	hero: z.boolean(),
});
export type ShowcaseSite = z.infer<typeof ShowcaseSiteSchema>;

export const ShowcaseFileSchema = z.strictObject({
	showcaseVersion: z.literal(SHOWCASE_VERSION),
	world: WorldInfoConfigSchema.optional(),
	sites: z.array(ShowcaseSiteSchema),
});
export type ShowcaseFile = z.infer<typeof ShowcaseFileSchema>;

export interface Showcase {
	title?: string;
	description?: string;
	links: { label: string; url: string }[];
	order?: number;
	/** Every site portal's id, in cabn.json order. */
	sitePortalIds: string[];
	heroPortalId: string | null;
}

export const EMPTY_SHOWCASE: Showcase = {
	links: [],
	sitePortalIds: [],
	heroPortalId: null,
};

const LooseShowcaseSchema = z.object({
	showcaseVersion: z.number(),
	world: z.unknown().optional(),
	sites: z.array(z.unknown()).optional(),
});

const LooseSiteSchema = z.object({
	portalId: z.string().startsWith(SITE_PORTAL_PREFIX),
	hero: z.boolean().optional(),
});

const LooseWorldSchema = z.object({
	title: z.string().max(200).optional(),
	description: z.string().max(WORLD_DESCRIPTION_MAX_CHARS).optional(),
	links: z.array(z.unknown()).optional(),
	order: z.number().int().optional(),
});

/**
 * Engine-side reader: never throws. A missing/garbled file or a future
 * version degrades to EMPTY_SHOWCASE (no hero, no description), which is
 * exactly how a world from before showcase.json behaves. Loose per field so a
 * later converter can add one without this engine dropping the rest.
 */
export function parseShowcase(json: unknown): Showcase {
	const loose = LooseShowcaseSchema.safeParse(json);
	if (!loose.success || loose.data.showcaseVersion !== SHOWCASE_VERSION)
		return EMPTY_SHOWCASE;
	const sitePortalIds: string[] = [];
	let heroPortalId: string | null = null;
	for (const raw of loose.data.sites ?? []) {
		const site = LooseSiteSchema.safeParse(raw);
		if (!site.success) continue;
		sitePortalIds.push(site.data.portalId);
		if (site.data.hero && heroPortalId === null)
			heroPortalId = site.data.portalId;
	}
	const world = LooseWorldSchema.safeParse(loose.data.world ?? {});
	const info = world.success ? world.data : {};
	const links: Showcase["links"] = [];
	for (const raw of info.links ?? []) {
		const link = WorldLinkSchema.safeParse(raw);
		if (link.success) links.push(link.data);
	}
	return {
		...(info.title !== undefined ? { title: info.title } : {}),
		...(info.description !== undefined
			? { description: info.description }
			: {}),
		links,
		...(info.order !== undefined ? { order: info.order } : {}),
		sitePortalIds,
		heroPortalId,
	};
}

/**
 * The union of every world's allowedEmbedOrigins (cabn.json configs or built
 * world.json manifests alike), sorted and deduplicated: what a host serving
 * several worlds lists in its Content-Security-Policy `frame-src`.
 */
export function collectEmbedOrigins(
	sources: Iterable<{ allowedEmbedOrigins?: readonly string[] | undefined }>,
): string[] {
	const out = new Set<string>();
	for (const source of sources) {
		for (const origin of source.allowedEmbedOrigins ?? []) out.add(origin);
	}
	return [...out].sort();
}
