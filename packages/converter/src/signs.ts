import {
	parseSeyn,
	SEYN_EXTENSION,
	SEYN_MAX_BYTES,
	type SeynDocument,
	type SignAnchor,
	SIGN_INDEX_VERSION,
	type SignEntry,
	type SignIndexFile,
	SignIndexFileSchema,
	seynDirOf,
	seynPlainText,
	truncateUtf8,
} from "@cabn/world-schema";
import type { SearchDoc } from "./search-index.js";
import type { WalkedFile } from "./walk.js";

export function isSeynPath(path: string): boolean {
	return path.toLowerCase().endsWith(SEYN_EXTENSION);
}

/** Just what anchor resolution needs from a built world — the converter passes its in-progress lists; `cabn serve` passes the parsed world.json. */
export interface SignWorldIndex {
	portalIds: ReadonlySet<string>;
	clusters: readonly { id: string; path: string; annexOf?: string }[];
}

function clusterForFolder(
	world: SignWorldIndex,
	folder: string,
): string | undefined {
	// A split directory's annexes share its path; the sign belongs by the
	// original, which is the one without annexOf.
	return world.clusters.find((c) => c.path === folder && !c.annexOf)?.id;
}

/**
 * `@near` when it names something in this world, else the fountain of the
 * nearest folder at or above the sign's own that has one, else the root.
 * Null only for a world with no clusters at all.
 */
export function resolveSignAnchor(
	signPath: string,
	doc: SeynDocument,
	world: SignWorldIndex,
): SignAnchor | null {
	const near = doc.near;
	if (near?.kind === "file" && world.portalIds.has(near.path))
		return { kind: "portal", id: near.path };
	if (near?.kind === "folder") {
		const id = clusterForFolder(world, near.path);
		if (id) return { kind: "cluster", id };
	}
	let dir = seynDirOf(signPath);
	for (;;) {
		const id = clusterForFolder(world, dir);
		if (id) return { kind: "cluster", id };
		if (dir === ".") break;
		dir = seynDirOf(dir);
	}
	const first = world.clusters[0];
	return first ? { kind: "cluster", id: first.id } : null;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** One .seyn file's bytes (or text) -> its signs.json entry, with the source cut at SEYN_MAX_BYTES the same way the parser cuts it. */
export function buildSignEntry(
	path: string,
	content: Uint8Array | string,
	world: SignWorldIndex,
): { entry: SignEntry; doc: SeynDocument } | null {
	const source = truncateUtf8(
		typeof content === "string" ? content : decoder.decode(content),
		SEYN_MAX_BYTES,
	);
	const doc = parseSeyn(source, { path });
	const anchor = resolveSignAnchor(path, doc, world);
	if (!anchor) return null;
	return { entry: { path, source, anchor }, doc };
}

/** Every walked .seyn file -> signs.json plus a search doc per sign. A sign whose content walk() didn't read (over maxFileBytes) is skipped rather than shipped empty. */
export function buildSignIndex(
	signFiles: readonly WalkedFile[],
	portals: readonly { id: string }[],
	clusters: SignWorldIndex["clusters"],
): { file: SignIndexFile; searchDocs: SearchDoc[] } {
	const world: SignWorldIndex = {
		portalIds: new Set(portals.map((p) => p.id)),
		clusters,
	};
	const signs: SignEntry[] = [];
	const searchDocs: SearchDoc[] = [];
	for (const file of [...signFiles].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	)) {
		if (!file.content) continue;
		const built = buildSignEntry(file.path, file.content, world);
		if (!built) continue;
		signs.push(built.entry);
		searchDocs.push({
			id: file.path,
			path: file.path,
			name: built.doc.title ?? file.path.slice(file.path.lastIndexOf("/") + 1),
			content: seynPlainText(built.doc),
		});
	}
	return {
		file: SignIndexFileSchema.parse({
			signsVersion: SIGN_INDEX_VERSION,
			signs,
		}),
		searchDocs,
	};
}
