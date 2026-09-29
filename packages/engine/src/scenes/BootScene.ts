import {
	EMBED_INDEX_FILENAME,
	type EmbedVerdict,
	HISTORY_INDEX_FILENAME,
	type HistoryIndexFile,
	MEDIA_INDEX_FILENAME,
	type MediaPreview,
	MONSTER_INDEX_FILENAME,
	type Monster,
	mergeMonsterIndex,
	parseEmbedIndex,
	parseHistoryIndex,
	parseMediaIndex,
	parseMonsterIndex,
	parseSignIndex,
	SIGN_INDEX_FILENAME,
	type SignEntry,
	validateManifest,
	validateShelf,
} from "@cabn/world-schema";
import Phaser from "phaser";

export type BootSceneData =
	| {
			worldUrl: string;
			returnTo?: { shelfUrl: string };
			/** This world's position in shelf.json's `worlds` (ShelfScene sets it); absent when a host boots a world directly. */
			shelfIndex?: number;
			/** Set when the rift reloads into an alternate universe: history.json stays the main world's (`historyBase`). */
			universe?: { slug: string; branch: string; historyBase: string };
	  }
	| { shelfUrl: string };

/**
 * Fetches and validates world.json/shelf.json before anything else touches
 * it — a malformed bundle should fail loudly here, not surface as a
 * confusing missing-sprite or undefined-position error three scenes later.
 */
export class BootScene extends Phaser.Scene {
	private target!: BootSceneData;

	constructor() {
		// active: false — Phaser would otherwise auto-start the first scene in
		// the game config's scene array before init() ever runs.
		super({ key: "boot", active: false });
	}

	init(data: BootSceneData): void {
		this.target = data;
	}

	preload(): void {
		// Phaser's loader skips a key already in the cache, so without this a
		// second world (another cabin, or a universe through the rift) would
		// boot with the first world's manifest.
		this.cache.json.remove("shelf-manifest");
		this.cache.json.remove("world-manifest");
		if ("shelfUrl" in this.target) {
			this.load.json("shelf-manifest", this.target.shelfUrl);
		} else {
			this.load.json("world-manifest", this.target.worldUrl);
		}
	}

	create(): void {
		// A manifest's own dir is the base for every relative path inside it
		// (chunks/<id>.json, a shelf entry's worldUrl, etc.) — derived here once
		// instead of re-parsed by every consumer downstream.
		if ("shelfUrl" in this.target) {
			const raw = this.cache.json.get("shelf-manifest");
			const shelfManifest = validateShelf(raw);
			const shelfBase = this.target.shelfUrl.slice(
				0,
				this.target.shelfUrl.lastIndexOf("/") + 1,
			);
			this.scene.start("preload", {
				shelfManifest,
				shelfBase,
				shelfUrl: this.target.shelfUrl,
			});
			return;
		}

		const raw = this.cache.json.get("world-manifest");
		const baseManifest = validateManifest(raw);
		const worldBase = this.target.worldUrl.slice(
			0,
			this.target.worldUrl.lastIndexOf("/") + 1,
		);
		const { returnTo, shelfIndex, universe } = this.target;
		const historyBase = universe?.historyBase ?? worldBase;
		Promise.all([
			loadMediaIndex(`${worldBase}${MEDIA_INDEX_FILENAME}`),
			loadMonsterIndex(`${worldBase}${MONSTER_INDEX_FILENAME}`),
			loadEmbedIndex(`${worldBase}${EMBED_INDEX_FILENAME}`),
			loadSignIndex(`${worldBase}${SIGN_INDEX_FILENAME}`),
			loadHistoryIndex(`${historyBase}${HISTORY_INDEX_FILENAME}`),
		]).then(([media, extraMonsters, embeds, signs, history]) => {
			if (!this.scene.isActive()) return;
			// Merged here, once, so every scene and HUD piece downstream sees one
			// `manifest.monsters` and never needs to know monsters.json exists.
			const manifest = mergeMonsterIndex(baseManifest, extraMonsters);
			this.scene.start("preload", {
				manifest,
				worldBase,
				returnTo,
				media,
				...(shelfIndex !== undefined ? { shelfIndex } : {}),
				embeds,
				signs,
				...(history
					? {
							git: {
								history,
								historyBase,
								universe: universe
									? { slug: universe.slug, branch: universe.branch }
									: null,
							},
						}
					: {}),
			});
		});
	}
}

/**
 * media.json is optional (bundles from before it existed don't have one) and
 * advisory (a portal without an entry just shows world.json's preview), so
 * every failure here — 404, an HTML fallback page, bad JSON, a future
 * version — resolves to "no media" rather than failing the world load.
 * Plain fetch, not the Phaser loader, for the same reason: a loader error
 * would be treated as a broken boot.
 */
async function loadMediaIndex(url: string): Promise<Map<string, MediaPreview>> {
	try {
		const res = await fetch(url);
		if (!res.ok) return new Map();
		return parseMediaIndex(await res.json());
	} catch {
		return new Map();
	}
}

/** Same contract as loadMediaIndex: optional, advisory, never fails the load. */
async function loadMonsterIndex(url: string): Promise<Monster[]> {
	try {
		const res = await fetch(url);
		if (!res.ok) return [];
		return parseMonsterIndex(await res.json());
	} catch {
		return [];
	}
}

/** history.json: same optional/advisory contract — no history just means no rift, timeline or pensieve. */
async function loadHistoryIndex(url: string): Promise<HistoryIndexFile | null> {
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		return parseHistoryIndex(await res.json());
	} catch {
		return null;
	}
}

/** embeds.json: same optional/advisory contract as media.json — any failure means "no verdicts", i.e. every url preview is tried as a live iframe as before. */
async function loadEmbedIndex(url: string): Promise<Map<string, EmbedVerdict>> {
	try {
		const res = await fetch(url);
		if (!res.ok) return new Map();
		return parseEmbedIndex(await res.json());
	} catch {
		return new Map();
	}
}

/** signs.json: same optional/advisory contract as media.json — any failure means a world without signs. */
async function loadSignIndex(url: string): Promise<SignEntry[]> {
	try {
		const res = await fetch(url);
		if (!res.ok) return [];
		return parseSignIndex(await res.json());
	} catch {
		return [];
	}
}
