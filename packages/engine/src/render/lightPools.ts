import Phaser from "phaser";
import { FX_SPARK_KEY } from "../assetPaths.js";
import { flickerAt } from "../systems/dayNight.js";

// FX_SPARK_KEY's own native size (gen-world-art.ts's buildSparkTexture) —
// scale is derived from this so a requested radiusPx always maps to the
// same actual on-screen size regardless of the sprite's raw pixel count.
export const SPARK_TEXTURE_SIZE_PX = 16;

/** Above render/atmosphere.ts's night grade (5.5) so the warm glow is added on top of the darkened scene, not darkened with it. */
export const LIGHT_POOL_DEPTH = 5.6;

export interface LightPoolOptions {
	x: number;
	y: number;
	/** Final on-screen radius of the glow. */
	radiusPx: number;
	/** 0xRRGGBB — additive blend means this is closer to "how warm" than "what color" once mixed with whatever's underneath. */
	color: number;
	alpha?: number;
	/** The bonfire and lanterns flicker; a plain window doesn't (a window is lit or not; a flame flickers). */
	flicker?: boolean;
}

export interface LightPool {
	opts: LightPoolOptions;
	sprite: Phaser.GameObjects.Image;
	baseAlpha: number;
	baseScale: number;
	phase: number;
}

/**
 * A soft warm glow at a fixed world position — additive-blended FX_SPARK_KEY
 * (the same shared soft-dot sprite render/effects.ts's particles use),
 * scaled and tinted per call rather than a bespoke texture per light source.
 * Always created (invisible by day) rather than built/destroyed on every
 * day/night toggle, so the 600ms cross-fade can ramp it in.
 */
export function createLightPool(
	scene: Phaser.Scene,
	opts: LightPoolOptions,
	index: number,
): LightPool {
	const sprite = scene.add.image(opts.x, opts.y, FX_SPARK_KEY);
	sprite.setBlendMode(Phaser.BlendModes.ADD);
	sprite.setTint(opts.color);
	const baseScale = (opts.radiusPx * 2) / SPARK_TEXTURE_SIZE_PX;
	sprite.setScale(baseScale);
	sprite.setDepth(LIGHT_POOL_DEPTH);
	sprite.setAlpha(0);
	return {
		opts,
		sprite,
		baseAlpha: opts.alpha ?? 0.55,
		baseScale,
		phase: index * 1.7,
	};
}

/** Current flicker multiplier for one pool — 1 when it doesn't flicker or motion is reduced. Shared with the night grade's light holes so both pulse together. */
export function poolFlicker(
	pool: LightPool,
	timeMs: number,
	reducedMotion: boolean,
): number {
	if (!pool.opts.flicker || reducedMotion) return 1;
	return flickerAt(timeMs, pool.phase);
}

export function updateLightPool(
	pool: LightPool,
	strength: number,
	flicker: number,
): void {
	const alpha = pool.baseAlpha * strength * flicker;
	pool.sprite.setVisible(alpha > 0.001);
	pool.sprite.setAlpha(alpha);
	pool.sprite.setScale(pool.baseScale * (0.94 + 0.06 * flicker));
}
