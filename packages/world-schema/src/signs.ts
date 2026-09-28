import { z } from "zod";
import { SEYN_EXTENSION, SEYN_MAX_BYTES } from "./seyn.js";

/**
 * Signs (`.seyn` files, docs/SEYN.md) ship in their own `signs.json` beside
 * world.json for the same reason media previews live in media.json: every
 * engine ever shipped parses world.json strictly, so a new top-level field
 * there would make an older engine reject the whole world. An older engine
 * never requests signs.json and shows the world without signs. The .seyn
 * files never become portals, so nothing in world.json refers to a sign.
 * CABN_VERSION is unchanged; the reader below is tolerant per entry.
 */
export const SIGN_INDEX_VERSION = 1;

export const SIGN_INDEX_FILENAME = "signs.json";

export const SignAnchorSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("portal"), id: z.string() }),
	z.strictObject({ kind: z.literal("cluster"), id: z.string() }),
]);
export type SignAnchor = z.infer<typeof SignAnchorSchema>;

export const SignPathSchema = z
	.string()
	.min(1)
	.max(512)
	.refine(
		(p) =>
			p.toLowerCase().endsWith(SEYN_EXTENSION) &&
			!p.startsWith("/") &&
			!p.includes("\\") &&
			!p.split("/").some((s) => s === "" || s === "." || s === ".."),
		{ message: "must be a world-relative .seyn path" },
	);

export const SignEntrySchema = z.strictObject({
	/** World-relative path of the .seyn file — also the sign's id. */
	path: SignPathSchema,
	/** Raw file text; the engine parses it with parseSeyn at display time. */
	source: z.string().max(SEYN_MAX_BYTES),
	/** What the sign stands beside, resolved by the converter against this world's portals/clusters. */
	anchor: SignAnchorSchema,
});
export type SignEntry = z.infer<typeof SignEntrySchema>;

export const SignIndexFileSchema = z.strictObject({
	signsVersion: z.literal(SIGN_INDEX_VERSION),
	signs: z.array(SignEntrySchema),
});
export type SignIndexFile = z.infer<typeof SignIndexFileSchema>;

const LooseSignIndexSchema = z.object({
	signsVersion: z.number(),
	signs: z.array(z.unknown()),
});

// Unknown keys stripped rather than rejected, so a later converter can add a
// field without this engine dropping the sign.
const LooseSignEntrySchema = z.object({
	path: SignPathSchema,
	source: z.string().max(SEYN_MAX_BYTES),
	anchor: z.object({ kind: z.enum(["portal", "cluster"]), id: z.string() }),
});

/**
 * Engine-side reader: never throws. A missing/garbled file or a future
 * signsVersion means no signs; a malformed or duplicate entry drops only
 * that sign.
 */
export function parseSignIndex(json: unknown): SignEntry[] {
	const loose = LooseSignIndexSchema.safeParse(json);
	if (!loose.success || loose.data.signsVersion !== SIGN_INDEX_VERSION)
		return [];
	const out: SignEntry[] = [];
	const seen = new Set<string>();
	for (const raw of loose.data.signs) {
		const entry = LooseSignEntrySchema.safeParse(raw);
		if (!entry.success || seen.has(entry.data.path)) continue;
		seen.add(entry.data.path);
		out.push({
			path: entry.data.path,
			source: entry.data.source,
			anchor: { kind: entry.data.anchor.kind, id: entry.data.anchor.id },
		});
	}
	return out;
}
