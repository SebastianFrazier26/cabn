import {
	parseSeyn,
	SEYN_EXTENSION,
	SEYN_MAX_BYTES,
	type SeynDocument,
	SIGN_INDEX_VERSION,
	type SignAnchor,
	type SignEntry,
	type SignIndexFile,
	SignIndexFileSchema,
	seynDirOf,
	seynNearValue,
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

/**
 * The `@near` value when it names a file or folder this world doesn't
 * have (deleted, renamed, ignored, a typo) — resolveSignAnchor then quietly
 * stands the sign by a fountain instead, which the author should hear about.
 * Undefined when there's no `@near` or it resolved.
 */
export function unresolvedSignNear(
	doc: SeynDocument,
	world: SignWorldIndex,
): string | undefined {
	const near = doc.near;
	if (!near) return undefined;
	if (near.kind === "file" && world.portalIds.has(near.path)) return undefined;
	if (near.kind === "folder" && clusterForFolder(world, near.path))
		return undefined;
	return seynNearValue(near);
}

function anchorLabel(anchor: SignAnchor, world: SignWorldIndex): string {
	if (anchor.kind === "portal") return anchor.id;
	const path = world.clusters.find((c) => c.id === anchor.id)?.path;
	return path === undefined || path === "."
		? "the root fountain"
		: `the ${path}/ fountain`;
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

/** A sign's search-index.json doc; the engine builds the same doc for a sign saved live in owner mode. */
export function signSearchDoc(path: string, doc: SeynDocument): SearchDoc {
	return {
		id: path,
		path,
		name: doc.title ?? path.slice(path.lastIndexOf("/") + 1),
		content: seynPlainText(doc),
	};
}

/** Every walked .seyn file -> signs.json plus a search doc per sign. A sign whose content walk() didn't read (over maxFileBytes) is skipped rather than shipped empty. */
export function buildSignIndex(
	signFiles: readonly WalkedFile[],
	portals: readonly { id: string }[],
	clusters: SignWorldIndex["clusters"],
	onWarning?: (message: string) => void,
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
		const missing = unresolvedSignNear(built.doc, world);
		if (missing !== undefined)
			onWarning?.(
				`sign ${file.path}: @near ${missing} is not in this world; it stands by ${anchorLabel(built.entry.anchor, world)} instead`,
			);
		signs.push(built.entry);
		searchDocs.push(signSearchDoc(file.path, built.doc));
	}
	return {
		file: SignIndexFileSchema.parse({
			signsVersion: SIGN_INDEX_VERSION,
			signs,
		}),
		searchDocs,
	};
}
