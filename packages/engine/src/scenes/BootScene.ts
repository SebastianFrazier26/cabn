import {
	EMBED_INDEX_FILENAME,
	type EmbedVerdict,
	MEDIA_INDEX_FILENAME,
	type MediaPreview,
	parseEmbedIndex,
	parseMediaIndex,
	validateManifest,
	validateShelf,
} from "@cabn/world-schema";
import Phaser from "phaser";

export type BootSceneData =
	| { worldUrl: string; returnTo?: { shelfUrl: string } }
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
		const manifest = validateManifest(raw);
		const worldBase = this.target.worldUrl.slice(
			0,
			this.target.worldUrl.lastIndexOf("/") + 1,
		);
		const returnTo = this.target.returnTo;
		Promise.all([
			loadMediaIndex(`${worldBase}${MEDIA_INDEX_FILENAME}`),
			loadEmbedIndex(`${worldBase}${EMBED_INDEX_FILENAME}`),
		]).then(([media, embeds]) => {
			if (!this.scene.isActive()) return;
			this.scene.start("preload", {
				manifest,
				worldBase,
				returnTo,
				media,
				embeds,
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
