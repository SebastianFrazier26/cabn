import Phaser from "phaser";
import { MONSTER_GHOST_KEY, monsterFrameKey } from "../assetPaths.js";
import {
	monsterDefeatAnim,
	monsterHitAnim,
	monsterIdleAnim,
} from "../scenes/PreloadScene.js";
import { resolveMonsterSpecies } from "../systems/monsterOrbit.js";
import { type SkinMonster, skinMonsterAnims } from "../systems/worldLayer.js";
import { fitSpriteToSize } from "./scale.js";

/** The species whose art will actually be drawn for `species` — itself if its idle animation loaded, else shade, else ghost (see systems/monsterOrbit.ts's resolveMonsterSpecies). */
export function renderedMonsterSpecies(
	scene: Phaser.Scene,
	species: string,
): string {
	return resolveMonsterSpecies(species, (s) =>
		s === "ghost"
			? scene.textures.exists(MONSTER_GHOST_KEY)
			: scene.anims.exists(monsterIdleAnim(s)),
	);
}

/** A layer skin's monster art by species (WorldSkin.monsters), already loaded and animated by WorldScene. */
export type MonsterSkinArt = Partial<Record<string, SkinMonster>> | null;

/** What a sprite plays: a still texture (ghost) or an idle loop, plus its battle animations when they exist. */
interface MonsterLook {
	/** The species whose art is shown (a fallback species when its own normal art is missing). */
	drawn: string;
	still: string;
	idle: string | null;
	hit: string | null;
	defeat: string | null;
}

function lookFor(
	scene: Phaser.Scene,
	species: string,
	skin: MonsterSkinArt,
): MonsterLook {
	const art = skin?.[species];
	if (art?.idle[0]) {
		const anims = skinMonsterAnims(art);
		const has = (key: string | null) =>
			key !== null && scene.anims.exists(key) ? key : null;
		if (anims.idle === null || has(anims.idle)) {
			return {
				drawn: species,
				still: art.idle[0].key,
				idle: has(anims.idle),
				hit: has(anims.hit),
				defeat: has(anims.defeat),
			};
		}
	}
	const drawn = renderedMonsterSpecies(scene, species);
	const has = (key: string) => (scene.anims.exists(key) ? key : null);
	return {
		drawn,
		still: drawn === "ghost" ? MONSTER_GHOST_KEY : monsterFrameKey(drawn, 0),
		idle: drawn === "ghost" ? null : monsterIdleAnim(drawn),
		hit: has(monsterHitAnim(drawn)),
		defeat: has(monsterDefeatAnim(drawn)),
	};
}

/** Ghost (M2) is a single static image with no idle animation — see assetPaths.ts's ANIMATED_MONSTER_SPECIES comment — so it's the one species that never gets `.play()`'d. A skin's art for the species, when given and loaded, takes its place at the same size. */
export function createMonsterSprite(
	scene: Phaser.Scene,
	x: number,
	y: number,
	species: string,
	targetPx: number,
	skin: MonsterSkinArt = null,
): Phaser.GameObjects.Sprite {
	const look = lookFor(scene, species, skin);
	const sprite = scene.add.sprite(x, y, look.still);
	fitSpriteToSize(sprite, targetPx);
	sprite.setData(DRAWN_SPECIES, look.drawn);
	sprite.setData(LOOK, look);
	if (look.idle) sprite.play(look.idle);
	return sprite;
}

/** Read by the e2e specs to find a species' sprite. */
const DRAWN_SPECIES = "monsterDrawnSpecies";
const LOOK = "monsterLook";
const HIT_FLASH_MS = 180;
const DEFEAT_HIT_MS = 110;

function lookOf(sprite: Phaser.GameObjects.Sprite): MonsterLook | undefined {
	return sprite.getData(LOOK) as MonsterLook | undefined;
}

function resumeIdle(
	sprite: Phaser.GameObjects.Sprite,
	look: MonsterLook,
): void {
	if (!sprite.active) return;
	if (look.idle) {
		sprite.play(look.idle);
	} else {
		sprite.stop();
		sprite.setTexture(look.still);
	}
}

/** A failed fix attempt landing: flashes the species' hit frame, then back to idle. False (and no-op) when that frame didn't load. */
export function playMonsterHit(
	scene: Phaser.Scene,
	sprite: Phaser.GameObjects.Sprite,
): boolean {
	const look = lookOf(sprite);
	if (!look?.hit) return false;
	sprite.play(look.hit);
	scene.time.delayedCall(HIT_FLASH_MS, () => resumeIdle(sprite, look));
	return true;
}

/**
 * Hit flash, then the three-frame poof, then the sprite destroys itself.
 * False when the species has no defeat frames — the caller keeps its own
 * tween-only fade for that case, so a partial asset set still reads as a
 * defeat.
 */
export function playMonsterDefeat(
	scene: Phaser.Scene,
	sprite: Phaser.GameObjects.Sprite,
): boolean {
	const look = lookOf(sprite);
	const defeat = look?.defeat;
	if (!look || !defeat) return false;
	const poof = () => {
		if (!sprite.active) return;
		sprite.once(
			`${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${defeat}`,
			() =>
				scene.tweens.add({
					targets: sprite,
					alpha: 0,
					duration: 140,
					onComplete: () => sprite.destroy(),
				}),
		);
		sprite.play(defeat);
	};
	if (look.hit) {
		sprite.play(look.hit);
		scene.time.delayedCall(DEFEAT_HIT_MS, poof);
	} else {
		poof();
	}
	return true;
}

/** A gentle up/down hover — FileScene's in-file monsters (world monsters move via render/monsterOrbit.ts instead). Randomized duration so a cluster of monsters doesn't bob in lockstep. */
export function addHoverBob(
	scene: Phaser.Scene,
	sprite: Phaser.GameObjects.Sprite,
	amplitude = 4,
): Phaser.Tweens.Tween {
	return scene.tweens.add({
		targets: sprite,
		y: sprite.y - amplitude,
		duration: 900 + Math.random() * 300,
		yoyo: true,
		repeat: -1,
		ease: "Sine.easeInOut",
	});
}
