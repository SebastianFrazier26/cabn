import type Phaser from "phaser";
import { ObjectPool } from "./rtPool.js";
import { WORLD_CHUNK_SIZE_PX } from "./worldChunkGrid.js";

/** Idle 512x512 RGBA textures are 1 MiB of GPU memory each; the walking window needs a ring of a few chunks per layer. */
export const CHUNK_RT_MAX_IDLE = 24;

const pools = new WeakMap<Phaser.Scene, ObjectPool<RenderTexturePoolItem>>();

type RenderTexturePoolItem = Phaser.GameObjects.RenderTexture;

function poolFor(scene: Phaser.Scene): ObjectPool<RenderTexturePoolItem> {
	let pool = pools.get(scene);
	if (!pool) {
		pool = new ObjectPool<RenderTexturePoolItem>({
			create: () =>
				scene.add.renderTexture(0, 0, WORLD_CHUNK_SIZE_PX, WORLD_CHUNK_SIZE_PX),
			unpark: (rt) => {
				rt.addToDisplayList();
				rt.setVisible(true).setActive(true);
			},
			reset: (rt) => {
				rt.clear();
				rt.clearTint().setAlpha(1).setDepth(0);
			},
			park: (rt) => {
				scene.tweens.killTweensOf(rt);
				rt.removeFromDisplayList();
				rt.setVisible(false).setActive(false);
			},
			destroy: (rt) => rt.destroy(),
			maxIdle: CHUNK_RT_MAX_IDLE,
		});
		pools.set(scene, pool);
	}
	return pool;
}

/** A blank 512px chunk texture centred at (x, y), recycled when one is free. Only for the chunk-sized bakes; anything else keeps using scene.add.renderTexture. */
export function acquireChunkRT(
	scene: Phaser.Scene,
	x: number,
	y: number,
): Phaser.GameObjects.RenderTexture {
	const rt = poolFor(scene).take();
	rt.setPosition(x, y);
	return rt;
}

/** Hands an evicted chunk texture back for reuse (destroys it when the pool is full or it isn't one of ours). */
export function releaseChunkRT(
	scene: Phaser.Scene,
	rt: Phaser.GameObjects.RenderTexture,
): void {
	if (!poolFor(scene).release(rt)) rt.destroy();
}

/** Makes up to `count` idle textures ahead of the first streamed bake. */
export function prewarmChunkRTs(scene: Phaser.Scene, count: number): number {
	return poolFor(scene).prewarm(count);
}

export function chunkRTPoolStats(scene: Phaser.Scene): {
	created: number;
	reused: number;
	idle: number;
	inUse: number;
} {
	const pool = poolFor(scene);
	return {
		created: pool.created,
		reused: pool.reused,
		idle: pool.idleCount,
		inUse: pool.inUseCount,
	};
}

export function destroyChunkRTPool(scene: Phaser.Scene): void {
	pools.get(scene)?.destroy();
	pools.delete(scene);
}
