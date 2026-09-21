import { validateManifest } from "@cabn/world-schema";
import Phaser from "phaser";

export interface BootSceneData {
	worldUrl: string;
}

/**
 * Fetches and validates world.json before anything else touches it — a
 * malformed bundle should fail loudly here, not surface as a confusing
 * missing-sprite or undefined-position error three scenes later.
 */
export class BootScene extends Phaser.Scene {
	private worldUrl = "";

	constructor() {
		// active: false — Phaser would otherwise auto-start the first scene in
		// the game config's scene array before worldUrl is ever set via init().
		super({ key: "boot", active: false });
	}

	init(data: BootSceneData): void {
		this.worldUrl = data.worldUrl;
	}

	preload(): void {
		this.load.json("world-manifest", this.worldUrl);
	}

	create(): void {
		const raw = this.cache.json.get("world-manifest");
		const manifest = validateManifest(raw);
		// world.json's own dir is the base for every relative path inside it
		// (chunks/<id>.json, etc.) — derived here once instead of re-parsed by
		// every consumer downstream.
		const worldBase = this.worldUrl.slice(
			0,
			this.worldUrl.lastIndexOf("/") + 1,
		);
		this.scene.start("preload", { manifest, worldBase });
	}
}
