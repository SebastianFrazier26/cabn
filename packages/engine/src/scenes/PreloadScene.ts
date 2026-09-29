import type {
	EmbedVerdict,
	MediaPreview,
	ShelfManifest,
	SignEntry,
	WorldManifest,
} from "@cabn/world-schema";
import Phaser from "phaser";
import {
	ANIMATED_MONSTER_SPECIES,
	ASSET_KEYS,
	ASSET_PATHS,
	atmosphereAssetEntries,
	BATTLE_FX_MONSTER_SPECIES,
	BIOME_TILE_FRAME_SIZE,
	BONFIRE_FRAME_COUNT,
	biomeTileSheetKey,
	biomeTileSheetPath,
	CASTLE_KEEP_KEY,
	CASTLE_KEEP_PATH,
	DECAL_FRAME_SIZE,
	DECAL_SHEET_KEY,
	DECAL_SHEET_PATH,
	FX_SPARK_KEY,
	FX_SPARK_PATH,
	MONSTER_DEFEAT_FRAME_COUNT,
	MONSTER_GHOST_KEY,
	MONSTER_GHOST_PATH,
	monsterDefeatKey,
	monsterDefeatPath,
	monsterFrameKey,
	monsterFramePath,
	monsterHitKey,
	monsterHitPath,
	OPTIONAL_ASSET_KEYS,
	OPTIONAL_ASSET_PATHS,
	PATH_STAMP_COUNT,
	PORTAL_ARCH_FRAME_COUNT,
	PORTAL_ARCH_FRAME_SIZE,
	PORTAL_VARIANT_SHEET_KEY,
	PORTAL_VARIANT_SHEET_PATH,
	PROP_NAMES,
	pathStampKey,
	pathStampPath,
	propKey,
	propPath,
	SHELF_CABIN_KEY,
	SHELF_CABIN_PATH,
	WORLD_ART_BIOMES,
	WORLD_FOUNTAIN_FRAME_COUNT,
	WORLD_FOUNTAIN_FRAME_HEIGHT,
	WORLD_FOUNTAIN_FRAME_WIDTH,
	WORLD_FOUNTAIN_GEM_KEY,
	WORLD_FOUNTAIN_GEM_PATH,
	WORLD_FOUNTAIN_IDLE_ANIM,
	WORLD_FOUNTAIN_KEY,
	WORLD_FOUNTAIN_PATH,
} from "../assetPaths.js";
import { preloadGuideNpcAssets } from "../render/guideNpc.js";
import { preloadSignAssets } from "../render/signposts.js";
import { perfMark } from "../systems/perfMarks.js";
import type { WorldGitData } from "./WorldScene.js";

export type PreloadSceneData =
	| {
			manifest: WorldManifest;
			worldBase: string;
			returnTo?: { shelfUrl: string };
			media?: ReadonlyMap<string, MediaPreview>;
			shelfIndex?: number;
			embeds?: ReadonlyMap<string, EmbedVerdict>;
			git?: WorldGitData;
			signs?: readonly SignEntry[];
	  }
	| { shelfManifest: ShelfManifest; shelfBase: string; shelfUrl: string };

export const PORTAL_IDLE_ANIM = "portal-idle";
export const BONFIRE_IDLE_ANIM = "bonfire-idle";

export function monsterIdleAnim(species: string): string {
	return `monster-idle-${species}`;
}

export function monsterHitAnim(species: string): string {
	return `monster-hit-${species}`;
}

export function monsterDefeatAnim(species: string): string {
	return `monster-defeat-${species}`;
}

/** Which of the not-yet-shipped art assets actually loaded this run — see assetPaths.ts. */
export interface AssetAvailability {
	wizardTower: boolean;
	bonfire: boolean;
	characterBack: boolean;
	/** All of: 3 biome tile sheets, the shared decal sheet, 4 path stamps, 10 props — WorldScene/ShelfScene fall back to tinted ellipses/dashed lines entirely if any one piece is missing, rather than a half-tiled scene. */
	worldArt: boolean;
	/** The procedural shelf cabin — ShelfScene falls back to the photographic ASSET_KEYS.cabin without it. */
	shelfCabin: boolean;
	/** All of the M10 atmosphere keys (assetPaths.ts#atmosphereAssetEntries) — edge scenery, skyline, sky ornaments, path-ribbon pieces. */
	atmosphereArt: boolean;
	/** The portal-type overlay sheet — without it every world arch is the generic one. */
	portalVariants: boolean;
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
		perfMark("cabn:preload:queue-start");
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
		this.load.spritesheet(PORTAL_VARIANT_SHEET_KEY, PORTAL_VARIANT_SHEET_PATH, {
			frameWidth: PORTAL_ARCH_FRAME_SIZE,
			frameHeight: PORTAL_ARCH_FRAME_SIZE,
		});

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
		for (const species of BATTLE_FX_MONSTER_SPECIES) {
			this.load.image(monsterHitKey(species), monsterHitPath(species));
			for (let i = 0; i < MONSTER_DEFEAT_FRAME_COUNT; i++) {
				this.load.image(
					monsterDefeatKey(species, i),
					monsterDefeatPath(species, i),
				);
			}
		}

		for (const biome of WORLD_ART_BIOMES) {
			this.load.spritesheet(
				biomeTileSheetKey(biome),
				biomeTileSheetPath(biome),
				{
					frameWidth: BIOME_TILE_FRAME_SIZE,
					frameHeight: BIOME_TILE_FRAME_SIZE,
				},
			);
		}
		this.load.spritesheet(DECAL_SHEET_KEY, DECAL_SHEET_PATH, {
			frameWidth: DECAL_FRAME_SIZE,
			frameHeight: DECAL_FRAME_SIZE,
		});
		for (let i = 0; i < PATH_STAMP_COUNT; i++) {
			this.load.image(pathStampKey(i), pathStampPath(i));
		}
		for (const name of PROP_NAMES) {
			this.load.image(propKey(name), propPath(name));
		}
		this.load.image(CASTLE_KEEP_KEY, CASTLE_KEEP_PATH);
		this.load.spritesheet(WORLD_FOUNTAIN_KEY, WORLD_FOUNTAIN_PATH, {
			frameWidth: WORLD_FOUNTAIN_FRAME_WIDTH,
			frameHeight: WORLD_FOUNTAIN_FRAME_HEIGHT,
		});
		this.load.image(WORLD_FOUNTAIN_GEM_KEY, WORLD_FOUNTAIN_GEM_PATH);
		this.load.image(SHELF_CABIN_KEY, SHELF_CABIN_PATH);
		preloadGuideNpcAssets(this.load);
		preloadSignAssets(this.load);
		this.load.image(FX_SPARK_KEY, FX_SPARK_PATH);
		for (const [key, path] of atmosphereAssetEntries()) {
			this.load.image(key, path);
		}
	}

	/**
	 * FILE_LOAD_ERROR alone misses a missing file on any host with an SPA
	 * fallback (vite preview, most static hosts with rewrites): the request
	 * "succeeds" with index.html, the image then fails to decode, and no
	 * texture is ever added — found while checking the shelf-cabin fallback,
	 * where every optional sprite rendered as an invisible missing texture
	 * instead of falling back.
	 */
	private loaded(key: string): boolean {
		return !this.missingOptional.has(key) && this.textures.exists(key);
	}

	create(): void {
		perfMark("cabn:preload:queue-complete");
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
			(_, i) => this.loaded(OPTIONAL_ASSET_KEYS.bonfireFrame(i)),
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
			// No animation => createMonsterSprite's fallback chain takes over.
			if (
				!this.loaded(monsterFrameKey(species, 0)) ||
				!this.loaded(monsterFrameKey(species, 1))
			)
				continue;
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

		// Registered as animations (even the one-frame hit) so render/
		// monsterSprite.ts can test anims.exists() — a texture key alone can't
		// tell a real load from the SPA-fallback miss loaded() guards against.
		for (const species of BATTLE_FX_MONSTER_SPECIES) {
			if (this.loaded(monsterHitKey(species))) {
				this.anims.create({
					key: monsterHitAnim(species),
					frames: [{ key: monsterHitKey(species) }],
					frameRate: 1,
				});
			}
			const defeatKeys = Array.from(
				{ length: MONSTER_DEFEAT_FRAME_COUNT },
				(_, i) => monsterDefeatKey(species, i),
			);
			if (defeatKeys.every((key) => this.loaded(key))) {
				this.anims.create({
					key: monsterDefeatAnim(species),
					frames: defeatKeys.map((key) => ({ key })),
					frameRate: 10,
					repeat: 0,
				});
			}
		}

		const worldArtKeys = [
			...WORLD_ART_BIOMES.map(biomeTileSheetKey),
			DECAL_SHEET_KEY,
			...Array.from({ length: PATH_STAMP_COUNT }, (_, i) => pathStampKey(i)),
			...PROP_NAMES.map(propKey),
			CASTLE_KEEP_KEY,
			WORLD_FOUNTAIN_KEY,
			WORLD_FOUNTAIN_GEM_KEY,
			FX_SPARK_KEY,
		];
		const worldArtAvailable = worldArtKeys.every((key) => this.loaded(key));
		if (worldArtAvailable) {
			this.anims.create({
				key: WORLD_FOUNTAIN_IDLE_ANIM,
				frames: this.anims.generateFrameNumbers(WORLD_FOUNTAIN_KEY, {
					start: 0,
					end: WORLD_FOUNTAIN_FRAME_COUNT - 1,
				}),
				frameRate: 8,
				repeat: -1,
			});
		}

		const availability: AssetAvailability = {
			wizardTower: this.loaded(OPTIONAL_ASSET_KEYS.wizardTower),
			bonfire: bonfireAvailable,
			characterBack: this.loaded(OPTIONAL_ASSET_KEYS.characterIdleBack),
			worldArt: worldArtAvailable,
			shelfCabin: this.loaded(SHELF_CABIN_KEY),
			atmosphereArt:
				worldArtAvailable &&
				atmosphereAssetEntries().every(([key]) => this.loaded(key)),
			portalVariants: this.loaded(PORTAL_VARIANT_SHEET_KEY),
		};

		perfMark("cabn:preload:create-end");
		if ("shelfManifest" in this.target) {
			this.scene.start("shelf", { ...this.target, availability });
		} else {
			this.scene.start("world", { ...this.target, availability });
		}
	}
}
