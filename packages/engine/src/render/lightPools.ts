import Phaser from "phaser";
import { FX_SPARK_KEY } from "../assetPaths.js";

// FX_SPARK_KEY's own native size (gen-world-art.ts's buildSparkTexture) —
// scale is derived from this so a requested radiusPx always maps to the
// same actual on-screen size regardless of the sprite's raw pixel count.
const SPARK_TEXTURE_SIZE_PX = 16;

export interface LightPoolOptions {
	x: number;
	y: number;
	/** Final on-screen radius of the glow. */
	radiusPx: number;
	/** 0xRRGGBB — additive blend means this is closer to "how warm" than "what color" once mixed with whatever's underneath. */
	color: number;
	alpha?: number;
	/** A gentle scale+alpha pulse — the bonfire and lanterns get this, a plain window doesn't (a window is lit or not; a flame flickers). */
	flicker?: boolean;
}

/**
 * A soft warm glow at a fixed world position — additive-blended FX_SPARK_KEY
 * (the same shared soft-dot sprite render/effects.ts's particles use),
 * scaled and tinted per call rather than a bespoke texture per light source.
 * M10b batch-3 review: night lighting was "mostly whole-frame darkening",
 * lamps/windows barely glowing — this is the actual local light source the
 * brief asked for, on top of (not instead of) the day/night glow-shader
 * grading batch 2 already does.
 */
export function createLightPool(
	scene: Phaser.Scene,
	opts: LightPoolOptions,
): Phaser.GameObjects.Image {
	const sprite = scene.add.image(opts.x, opts.y, FX_SPARK_KEY);
	sprite.setBlendMode(Phaser.BlendModes.ADD);
	sprite.setTint(opts.color);
	const baseAlpha = opts.alpha ?? 0.55;
	sprite.setAlpha(baseAlpha);
	const baseScale = (opts.radiusPx * 2) / SPARK_TEXTURE_SIZE_PX;
	sprite.setScale(baseScale);
	// Above ground/props/decals, below the always-on-top player (5) — same
	// band as render/effects.ts's ambient particles.
	sprite.setDepth(4.8);

	if (opts.flicker) {
		scene.tweens.add({
			targets: sprite,
			alpha: { from: baseAlpha, to: baseAlpha * 0.72 },
			scale: { from: baseScale, to: baseScale * 1.08 },
			duration: Phaser.Math.Between(700, 1100),
			yoyo: true,
			repeat: -1,
			ease: "Sine.easeInOut",
		});
	}

	return sprite;
}

export interface LightPoolHandle {
	destroy(): void;
}

/** Creates every light in one call and hands back a single destroy() — WorldScene/ShelfScene tear the whole set down together whenever timeOfDay flips back to day. */
export function attachLightPools(
	scene: Phaser.Scene,
	lights: readonly LightPoolOptions[],
): LightPoolHandle {
	const sprites = lights.map((light) => createLightPool(scene, light));
	return {
		destroy: () => {
			for (const sprite of sprites) sprite.destroy();
		},
	};
}
