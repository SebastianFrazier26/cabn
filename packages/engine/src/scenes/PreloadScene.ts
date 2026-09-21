import type { WorldManifest } from "@cabn/world-schema";
import Phaser from "phaser";
import {
	ASSET_KEYS,
	ASSET_PATHS,
	PORTAL_ARCH_FRAME_COUNT,
	PORTAL_ARCH_FRAME_SIZE,
} from "../assetPaths.js";

export interface PreloadSceneData {
	manifest: WorldManifest;
	worldBase: string;
}

export const PORTAL_IDLE_ANIM = "portal-idle";

export class PreloadScene extends Phaser.Scene {
	private manifest!: WorldManifest;
	private worldBase = "";

	constructor() {
		super({ key: "preload", active: false });
	}

	init(data: PreloadSceneData): void {
		this.manifest = data.manifest;
		this.worldBase = data.worldBase;
	}

	preload(): void {
		this.load.image(ASSET_KEYS.cabin, ASSET_PATHS[ASSET_KEYS.cabin]);
		this.load.image(ASSET_KEYS.cabinet, ASSET_PATHS[ASSET_KEYS.cabinet]);
		this.load.image(
			ASSET_KEYS.characterIdle,
			ASSET_PATHS[ASSET_KEYS.characterIdle],
		);
		this.load.spritesheet(
			ASSET_KEYS.portalArchStrip,
			ASSET_PATHS[ASSET_KEYS.portalArchStrip],
			{
				frameWidth: PORTAL_ARCH_FRAME_SIZE,
				frameHeight: PORTAL_ARCH_FRAME_SIZE,
			},
		);
	}

	create(): void {
		this.anims.create({
			key: PORTAL_IDLE_ANIM,
			frames: this.anims.generateFrameNumbers(ASSET_KEYS.portalArchStrip, {
				start: 0,
				end: PORTAL_ARCH_FRAME_COUNT - 1,
			}),
			frameRate: 8,
			repeat: -1,
		});
		this.scene.start("world", {
			manifest: this.manifest,
			worldBase: this.worldBase,
		});
	}
}
