import Phaser from "phaser";
import { FX_SPARK_KEY } from "../assetPaths.js";
import { hashStringSeed, mulberry32 } from "../systems/deterministicRandom.js";
import type { AtmosphereHandle } from "./atmosphere.js";

const CLOUD_COUNT = 5;
const CLOUD_DRIFT_PX_PER_S = 9;
const CLOUD_ALPHA = 0.14;
/** Under the night grade so they're darkened with the ground, above props so they pass over rooftops too. */
const CLOUD_DEPTH = 4.9;

/**
 * A few huge, very soft dark blobs drifting slowly across the ground by day —
 * the cheapest possible "sunny afternoon" cue (five sprites, no texture of
 * their own: the shared spark dot, tinted and stretched). Fade out with the
 * day/night blend; frozen in place under reduced motion.
 */
export function attachCloudShadows(
	scene: Phaser.Scene,
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	seed: string,
	atmosphere: AtmosphereHandle,
	reducedMotion: boolean,
): { destroy(): void } {
	const rand = mulberry32(hashStringSeed(`clouds:${seed}`));
	const width = bounds.maxX - bounds.minX;
	const clouds = Array.from({ length: CLOUD_COUNT }, () => {
		const cloud = scene.add
			.image(
				bounds.minX + rand() * width,
				bounds.minY + rand() * (bounds.maxY - bounds.minY),
				FX_SPARK_KEY,
			)
			.setTint(0x1d2a3c)
			.setScale(26 + rand() * 18, 13 + rand() * 8)
			.setDepth(CLOUD_DEPTH);
		return { cloud, speed: CLOUD_DRIFT_PX_PER_S * (0.7 + rand() * 0.6) };
	});

	atmosphere.onBlend((b) => {
		for (const { cloud } of clouds) {
			cloud.setVisible(b < 0.999).setAlpha(CLOUD_ALPHA * (1 - b));
		}
	});

	const onUpdate = (_time: number, delta: number): void => {
		if (reducedMotion) return;
		for (const c of clouds) {
			c.cloud.x += (c.speed * delta) / 1000;
			const half = c.cloud.displayWidth / 2;
			if (c.cloud.x - half > bounds.maxX) c.cloud.x = bounds.minX - half;
		}
	};
	scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

	return {
		destroy: () => {
			scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
			for (const { cloud } of clouds) cloud.destroy();
		},
	};
}
