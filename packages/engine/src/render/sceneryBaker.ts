import Phaser from "phaser";
import { type SceneryName, sceneryKey } from "../assetPaths.js";
import type {
	Footprint,
	SceneryItem,
	SceneryKind,
} from "../systems/edgeScenery.js";
import {
	parseWorldChunkKey,
	WORLD_CHUNK_SIZE_PX,
	worldChunkKey,
} from "./worldChunkGrid.js";

export interface SceneryBakeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const CHUNK_SIZE_PX = WORLD_CHUNK_SIZE_PX;

/** Two multiply tints applied as one, channel by channel. */
export function multiplyTint(a: number, b: number): number {
	const ch = (shift: number) =>
		Math.round((((a >> shift) & 0xff) * ((b >> shift) & 0xff)) / 255);
	return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function sceneryTextureKey(kind: SceneryKind): string {
	return sceneryKey(kind);
}

/** Every kind's real texture size, read off the loaded textures so the pure planner's keepout checks use the same boxes the baker draws. */
export function sceneryFootprints(
	scene: Phaser.Scene,
	kinds: readonly SceneryKind[],
): Record<SceneryKind, Footprint> {
	const out = {} as Record<SceneryKind, Footprint>;
	for (const kind of kinds) {
		const source = scene.textures
			.get(sceneryTextureKey(kind))
			.getSourceImage() as {
			width: number;
			height: number;
		};
		out[kind] = { w: source.width, h: source.height };
	}
	return out;
}

export interface SceneryChunkSkin {
	/** A world skin's replacement textures and tint (render/worldDressing.ts). */
	textureFor?: (kind: SceneryName) => string | undefined;
	tint?: number;
}

/**
 * Which chunk(s) each planned item's footprint overlaps — pure grouping,
 * split out of bakeScenery so a streamer (WorldScene's edgeSceneryStreamer)
 * can bake one chunk's items on demand instead of every chunk up front. An
 * item straddling a seam lands in every chunk its footprint touches, same as
 * groundField.ts's chunk math and worldChunkGrid.ts's indexPointsByChunk —
 * kept as its own loop rather than reusing that helper because a footprint's
 * box isn't centered on the item's own point (origin is bottom-center, see
 * stampFor's `setOrigin(0.5, 1)` below), so the box math differs slightly.
 */
export function groupSceneryItemsByChunk(
	items: readonly SceneryItem[],
	footprints: Readonly<Record<SceneryKind, Footprint>>,
	chunkSize = CHUNK_SIZE_PX,
): Map<string, SceneryItem[]> {
	const chunkItems = new Map<string, SceneryItem[]>();
	for (const item of items) {
		const fp = footprints[item.kind];
		const c0 = Math.floor((item.x - fp.w / 2) / chunkSize);
		const c1 = Math.floor((item.x + fp.w / 2) / chunkSize);
		const r0 = Math.floor((item.y - fp.h) / chunkSize);
		const r1 = Math.floor(item.y / chunkSize);
		for (let r = r0; r <= r1; r++) {
			for (let c = c0; c <= c1; c++) {
				const key = worldChunkKey(c, r);
				let list = chunkItems.get(key);
				if (!list) {
					list = [];
					chunkItems.set(key, list);
				}
				list.push(item);
			}
		}
	}
	return chunkItems;
}

/**
 * One chunk's scenery bake, given the items `groupSceneryItemsByChunk`
 * already assigned to it (items are drawn in the planner's y-sorted order,
 * so overlapping trees stack the same way regardless of which side of a seam
 * they're drawn from) — null if the list is empty, so a streamer can record
 * "checked, nothing here" without creating a throwaway RenderTexture.
 */
export function bakeSceneryChunk(
	scene: Phaser.Scene,
	chunkCol: number,
	chunkRow: number,
	items: readonly SceneryItem[],
	depth: number,
	skin: SceneryChunkSkin = {},
): Phaser.GameObjects.RenderTexture | null {
	if (items.length === 0) return null;
	const originX = chunkCol * CHUNK_SIZE_PX;
	const originY = chunkRow * CHUNK_SIZE_PX;
	const rt = scene.add.renderTexture(
		originX + CHUNK_SIZE_PX / 2,
		originY + CHUNK_SIZE_PX / 2,
		CHUNK_SIZE_PX,
		CHUNK_SIZE_PX,
	);
	const stamps = new Map<string, Phaser.GameObjects.Image>();
	const stampFor = (kind: SceneryKind): Phaser.GameObjects.Image => {
		const key = skin.textureFor?.(kind) ?? sceneryTextureKey(kind);
		let image = stamps.get(key);
		if (!image) {
			image = scene.make.image({ key }, false).setOrigin(0.5, 1);
			stamps.set(key, image);
		}
		return image;
	};
	// Batched for the same reason as pathBaker.ts's ribbon bake.
	rt.beginDraw();
	for (const item of items) {
		const image = stampFor(item.kind);
		const swapped = skin.textureFor?.(item.kind) !== undefined;
		image
			.setFlipX(item.flipX)
			.setTint(
				skin.tint === undefined || swapped
					? item.tint
					: multiplyTint(item.tint, skin.tint),
			);
		rt.batchDraw(image, item.x - originX, item.y - originY);
	}
	rt.endDraw();
	rt.setDepth(depth);
	for (const image of stamps.values()) image.destroy();
	return rt;
}

/**
 * Bakes every planned scenery item into fixed 512px RenderTexture chunks —
 * the same one-draw-call-per-chunk trade groundField.ts makes, and the reason
 * a 600-tree border forest costs the frame nothing after scene creation. Only
 * chunks that actually contain scenery are created. Still used whole-bounds
 * by ShelfScene and as the non-streamed fallback; WorldScene instead streams
 * chunks in via bakeSceneryChunk + render/chunkStream.ts (see drawEdgeScenery
 * in WorldScene.ts), same shape as its ground-field streaming.
 */
export function bakeScenery(
	scene: Phaser.Scene,
	_bounds: SceneryBakeBounds,
	items: readonly SceneryItem[],
	footprints: Readonly<Record<SceneryKind, Footprint>>,
	depth: number,
	skin: SceneryChunkSkin = {},
): Phaser.GameObjects.RenderTexture[] {
	const chunkItems = groupSceneryItemsByChunk(items, footprints);
	const chunks: Phaser.GameObjects.RenderTexture[] = [];
	for (const [key, list] of chunkItems) {
		const { col, row } = parseWorldChunkKey(key);
		const rt = bakeSceneryChunk(scene, col, row, list, depth, skin);
		if (rt) chunks.push(rt);
	}
	return chunks;
}

/** The windmill's sails: the one live (not baked) edge sprite, turning slowly. Hub position is hand-measured against world-art/scenery.ts's windmillBody grid (roof apex/window rows). */
export function addWindmillSails(
	scene: Phaser.Scene,
	x: number,
	y: number,
	bodyHeight: number,
	depth: number,
	reducedMotion: boolean,
	tint?: number,
	/** A world skin's redrawn sails; they then take no tint. */
	textureKey?: string,
): Phaser.GameObjects.Image {
	const sails = scene.add
		.image(x, y - bodyHeight * 0.62, textureKey ?? sceneryKey("windmill-sails"))
		.setDepth(depth);
	if (tint !== undefined && textureKey === undefined) sails.setTint(tint);
	if (!reducedMotion) {
		scene.tweens.add({
			targets: sails,
			angle: 360,
			duration: 14_000,
			repeat: -1,
			ease: Phaser.Math.Easing.Linear,
		});
	}
	return sails;
}
