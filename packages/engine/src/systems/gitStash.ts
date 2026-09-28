import { loadSave } from "./save.js";

/**
 * The owner's in-browser stash: saved-but-uncommitted edits set aside when
 * switching branches in `cabn serve --owner`, keyed by the repository
 * (the main world's source) and the branch they were made on, so returning
 * to that branch offers them back. Only saved edits are involved — the rift
 * stands in the world, where no file buffer is open.
 */
const PREFIX = "cabn:git-stash:";

export interface BrowserStash {
	branch: string;
	savedAt: string;
	/** Portal id (world path) -> saved text. */
	files: Record<string, string>;
}

function fnv1a(str: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stashKey(rootSource: string, branch: string): string {
	return `${PREFIX}${fnv1a(rootSource)}:${encodeURIComponent(branch)}`;
}

/** The world's saved edits (what an owner commit would send). */
export function savedEdits(worldId: string): Record<string, string> {
	const save = loadSave(worldId);
	return Object.fromEntries(
		Object.entries(save.fileOverrides).map(([id, o]) => [id, o.content]),
	);
}

export function writeStash(
	storage: Pick<Storage, "setItem">,
	rootSource: string,
	stash: BrowserStash,
): void {
	storage.setItem(stashKey(rootSource, stash.branch), JSON.stringify(stash));
}

export function readStash(
	storage: Pick<Storage, "getItem">,
	rootSource: string,
	branch: string,
): BrowserStash | null {
	try {
		const raw = storage.getItem(stashKey(rootSource, branch));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<BrowserStash>;
		if (
			parsed.branch !== branch ||
			typeof parsed.savedAt !== "string" ||
			typeof parsed.files !== "object" ||
			parsed.files === null
		)
			return null;
		const files: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed.files))
			if (typeof v === "string") files[k] = v;
		return { branch, savedAt: parsed.savedAt, files };
	} catch {
		return null;
	}
}

export function clearStash(
	storage: Pick<Storage, "removeItem">,
	rootSource: string,
	branch: string,
): void {
	storage.removeItem(stashKey(rootSource, branch));
}
