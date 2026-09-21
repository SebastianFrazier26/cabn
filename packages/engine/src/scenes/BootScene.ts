import { validateManifest, validateShelf } from "@cabn/world-schema";
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
		this.scene.start("preload", {
			manifest,
			worldBase,
			returnTo: this.target.returnTo,
		});
	}
}
