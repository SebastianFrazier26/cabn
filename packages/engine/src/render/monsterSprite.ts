import type Phaser from "phaser";
import { MONSTER_GHOST_KEY, monsterFrameKey } from "../assetPaths.js";
import { monsterIdleAnim } from "../scenes/PreloadScene.js";
import { fitSpriteToSize } from "./scale.js";

/** Ghost (M2) is a single static image with no idle animation — see assetPaths.ts's ANIMATED_MONSTER_SPECIES comment — so it's the one species that never gets `.play()`'d. */
export function createMonsterSprite(
	scene: Phaser.Scene,
	x: number,
	y: number,
	species: string,
	targetPx: number,
): Phaser.GameObjects.Sprite {
	const sprite =
		species === "ghost"
			? scene.add.sprite(x, y, MONSTER_GHOST_KEY)
			: scene.add.sprite(x, y, monsterFrameKey(species, 0));
	fitSpriteToSize(sprite, targetPx);
	if (species !== "ghost") sprite.play(monsterIdleAnim(species));
	return sprite;
}

/** A gentle up/down hover — shared by every monster sprite in every scene, a tween rather than per-frame update() math since nothing else about the sprite needs per-frame attention. Randomized duration so a cluster of monsters doesn't bob in lockstep. */
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
