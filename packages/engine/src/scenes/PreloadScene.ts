import type { ShelfManifest, WorldManifest } from "@cabn/world-schema";
import Phaser from "phaser";
import {
	ANIMATED_MONSTER_SPECIES,
	ASSET_KEYS,
	ASSET_PATHS,
	BONFIRE_FRAME_COUNT,
	MONSTER_GHOST_KEY,
	MONSTER_GHOST_PATH,
	monsterFrameKey,
	monsterFramePath,
	OPTIONAL_ASSET_KEYS,
	OPTIONAL_ASSET_PATHS,
	PORTAL_ARCH_FRAME_COUNT,
	PORTAL_ARCH_FRAME_SIZE,
} from "../assetPaths.js";

export type PreloadSceneData =
	| {
			manifest: WorldManifest;
			worldBase: string;
			returnTo?: { shelfUrl: string };
	  }
	| { shelfManifest: ShelfManifest; shelfBase: string; shelfUrl: string };

export const PORTAL_IDLE_ANIM = "portal-idle";
export const BONFIRE_IDLE_ANIM = "bonfire-idle";

export function monsterIdleAnim(species: string): string {
	return `monster-idle-${species}`;
}

/** Which of the not-yet-shipped art assets actually loaded this run — see assetPaths.ts. */
export interface AssetAvailability {
	wizardTower: boolean;
	bonfire: boolean;
	characterBack: boolean;
}

export class PreloadScene extends Phaser.Scene {
	private target!: PreloadSceneData;
	private missingOptional = new Set<string>();

	constructor() {
		super({ key: "preload", active: false });
	}

	init(data: PreloadSceneData): void {
		this.target = data;
		this.missingOptional = new Set();
	}

	preload(): void {
		this.load.on(
			Phaser.Loader.Events.FILE_LOAD_ERROR,
			(file: { key: string }) => {
				this.missingOptional.add(file.key);
			},
		);

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

		this.load.image(
			OPTIONAL_ASSET_KEYS.wizardTower,
			OPTIONAL_ASSET_PATHS[OPTIONAL_ASSET_KEYS.wizardTower],
		);
		this.load.image(
			OPTIONAL_ASSET_KEYS.characterIdleBack,
			OPTIONAL_ASSET_PATHS[OPTIONAL_ASSET_KEYS.characterIdleBack],
		);
		for (let i = 0; i < BONFIRE_FRAME_COUNT; i++) {
			this.load.image(
				OPTIONAL_ASSET_KEYS.bonfireFrame(i),
				OPTIONAL_ASSET_PATHS.bonfireFrame(i),
			);
		}

		this.load.image(MONSTER_GHOST_KEY, MONSTER_GHOST_PATH);
		for (const species of ANIMATED_MONSTER_SPECIES) {
			this.load.image(
				monsterFrameKey(species, 0),
				monsterFramePath(species, 0),
			);
			this.load.image(
				monsterFrameKey(species, 1),
				monsterFramePath(species, 1),
			);
		}
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

		const bonfireAvailable = Array.from(
			{ length: BONFIRE_FRAME_COUNT },
			(_, i) => !this.missingOptional.has(OPTIONAL_ASSET_KEYS.bonfireFrame(i)),
		).every(Boolean);
		if (bonfireAvailable) {
			this.anims.create({
				key: BONFIRE_IDLE_ANIM,
				// Four standalone textures, not one spritesheet — each frame config
				// names its own texture key instead of a shared key + frame index.
				frames: Array.from({ length: BONFIRE_FRAME_COUNT }, (_, i) => ({
					key: OPTIONAL_ASSET_KEYS.bonfireFrame(i),
				})),
				frameRate: 6,
				repeat: -1,
			});
		}

		for (const species of ANIMATED_MONSTER_SPECIES) {
			this.anims.create({
				key: monsterIdleAnim(species),
				frames: [
					{ key: monsterFrameKey(species, 0) },
					{ key: monsterFrameKey(species, 1) },
				],
				frameRate: 3,
				repeat: -1,
			});
		}

		const availability: AssetAvailability = {
			wizardTower: !this.missingOptional.has(OPTIONAL_ASSET_KEYS.wizardTower),
			bonfire: bonfireAvailable,
			characterBack: !this.missingOptional.has(
				OPTIONAL_ASSET_KEYS.characterIdleBack,
			),
		};

		if ("shelfManifest" in this.target) {
			this.scene.start("shelf", { ...this.target, availability });
		} else {
			this.scene.start("world", { ...this.target, availability });
		}
	}
}
