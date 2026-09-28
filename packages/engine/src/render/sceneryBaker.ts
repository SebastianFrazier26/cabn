import Phaser from "phaser";
import { sceneryKey } from "../assetPaths.js";
import type {
	Footprint,
	SceneryItem,
	SceneryKind,
} from "../systems/edgeScenery.js";

export interface SceneryBakeBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const CHUNK_SIZE_PX = 512;

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

/**
 * Bakes every planned scenery item into fixed 512px RenderTexture chunks —
 * the same one-draw-call-per-chunk trade groundField.ts makes, and the reason
 * a 600-tree border forest costs the frame nothing after scene creation. Only
 * chunks that actually contain scenery are created. An item straddling a
 * chunk seam is drawn into every chunk it touches (each clips its own part),
 * and items are drawn in the planner's y-sorted order in every chunk so
 * overlapping trees stack the same way on both sides of a seam.
 */
export function bakeScenery(
	scene: Phaser.Scene,
	bounds: SceneryBakeBounds,
	items: readonly SceneryItem[],
	footprints: Readonly<Record<SceneryKind, Footprint>>,
	depth: number,
): Phaser.GameObjects.RenderTexture[] {
	const startCol = Math.floor(bounds.minX / CHUNK_SIZE_PX);
	const startRow = Math.floor(bounds.minY / CHUNK_SIZE_PX);
	const chunkItems = new Map<string, SceneryItem[]>();
	for (const item of items) {
		const fp = footprints[item.kind];
		const c0 = Math.floor((item.x - fp.w / 2) / CHUNK_SIZE_PX);
		const c1 = Math.floor((item.x + fp.w / 2) / CHUNK_SIZE_PX);
		const r0 = Math.floor((item.y - fp.h) / CHUNK_SIZE_PX);
		const r1 = Math.floor(item.y / CHUNK_SIZE_PX);
		for (let r = Math.max(r0, startRow); r <= r1; r++) {
			for (let c = Math.max(c0, startCol); c <= c1; c++) {
				const key = `${c},${r}`;
				let list = chunkItems.get(key);
				if (!list) {
					list = [];
					chunkItems.set(key, list);
				}
				list.push(item);
			}
		}
	}

	const stamps = new Map<string, Phaser.GameObjects.Image>();
	const stampFor = (kind: SceneryKind): Phaser.GameObjects.Image => {
		const key = sceneryTextureKey(kind);
		let image = stamps.get(key);
		if (!image) {
			image = scene.make.image({ key }, false).setOrigin(0.5, 1);
			stamps.set(key, image);
		}
		return image;
	};

	const chunks: Phaser.GameObjects.RenderTexture[] = [];
	for (const [key, list] of chunkItems) {
		const [c, r] = key.split(",").map(Number) as [number, number];
		const originX = c * CHUNK_SIZE_PX;
		const originY = r * CHUNK_SIZE_PX;
		const rt = scene.add.renderTexture(
			originX + CHUNK_SIZE_PX / 2,
			originY + CHUNK_SIZE_PX / 2,
			CHUNK_SIZE_PX,
			CHUNK_SIZE_PX,
		);
		for (const item of list) {
			const image = stampFor(item.kind);
			image.setFlipX(item.flipX).setTint(item.tint);
			rt.draw(image, item.x - originX, item.y - originY);
		}
		rt.setDepth(depth);
		chunks.push(rt);
	}
	for (const image of stamps.values()) image.destroy();
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
): Phaser.GameObjects.Image {
	const sails = scene.add
		.image(x, y - bodyHeight * 0.62, sceneryKey("windmill-sails"))
		.setDepth(depth);
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
