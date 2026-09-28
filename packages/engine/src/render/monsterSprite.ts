import Phaser from "phaser";
import { MONSTER_GHOST_KEY, monsterFrameKey } from "../assetPaths.js";
import {
	monsterDefeatAnim,
	monsterHitAnim,
	monsterIdleAnim,
} from "../scenes/PreloadScene.js";
import { resolveMonsterSpecies } from "../systems/monsterOrbit.js";
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

/** Ghost (M2) is a single static image with no idle animation — see assetPaths.ts's ANIMATED_MONSTER_SPECIES comment — so it's the one species that never gets `.play()`'d. */
export function createMonsterSprite(
	scene: Phaser.Scene,
	x: number,
	y: number,
	species: string,
	targetPx: number,
): Phaser.GameObjects.Sprite {
	const drawn = renderedMonsterSpecies(scene, species);
	const sprite =
		drawn === "ghost"
			? scene.add.sprite(x, y, MONSTER_GHOST_KEY)
			: scene.add.sprite(x, y, monsterFrameKey(drawn, 0));
	fitSpriteToSize(sprite, targetPx);
	sprite.setData(DRAWN_SPECIES, drawn);
	if (drawn !== "ghost") sprite.play(monsterIdleAnim(drawn));
	return sprite;
}

const DRAWN_SPECIES = "monsterDrawnSpecies";
const HIT_FLASH_MS = 180;
const DEFEAT_HIT_MS = 110;

function drawnSpecies(sprite: Phaser.GameObjects.Sprite): string | undefined {
	return sprite.getData(DRAWN_SPECIES) as string | undefined;
}

function resumeIdle(sprite: Phaser.GameObjects.Sprite, species: string): void {
	if (!sprite.active) return;
	if (species === "ghost") {
		sprite.stop();
		sprite.setTexture(MONSTER_GHOST_KEY);
	} else {
		sprite.play(monsterIdleAnim(species));
	}
}

/** A failed fix attempt landing: flashes the species' hit frame, then back to idle. False (and no-op) when that frame didn't load. */
export function playMonsterHit(
	scene: Phaser.Scene,
	sprite: Phaser.GameObjects.Sprite,
): boolean {
	const species = drawnSpecies(sprite);
	if (!species || !scene.anims.exists(monsterHitAnim(species))) return false;
	sprite.play(monsterHitAnim(species));
	scene.time.delayedCall(HIT_FLASH_MS, () => resumeIdle(sprite, species));
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
	const species = drawnSpecies(sprite);
	if (!species || !scene.anims.exists(monsterDefeatAnim(species))) return false;
	const poof = () => {
		if (!sprite.active) return;
		sprite.once(
			`${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${monsterDefeatAnim(species)}`,
			() =>
				scene.tweens.add({
					targets: sprite,
					alpha: 0,
					duration: 140,
					onComplete: () => sprite.destroy(),
				}),
		);
		sprite.play(monsterDefeatAnim(species));
	};
	if (scene.anims.exists(monsterHitAnim(species))) {
		sprite.play(monsterHitAnim(species));
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
