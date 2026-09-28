import type Phaser from "phaser";
import { MONSTER_GHOST_KEY, monsterFrameKey } from "../assetPaths.js";
import { monsterIdleAnim } from "../scenes/PreloadScene.js";
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
	if (drawn !== "ghost") sprite.play(monsterIdleAnim(drawn));
	return sprite;
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
