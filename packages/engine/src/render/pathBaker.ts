import type { Position } from "@cabn/world-schema";
import type Phaser from "phaser";
import { PATH_STAMP_COUNT, pathStampKey } from "../assetPaths.js";
import { hashStringSeed, mulberry32 } from "../systems/deterministicRandom.js";
import { stampPointsAlongSegment } from "./pathStamps.js";

export interface WorldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PathSegment {
	/** Seeds both stamp-variant choice and jitter for this segment — pass a stable id (e.g. `${from}::${to}`), not an array index, so re-ordering `manifest.paths` doesn't reshuffle the art. */
	id: string;
	from: Position;
	to: Position;
}

const STAMP_JITTER_PX = 2;
// Segments abut with a slight overlap (not edge-to-edge exactly) so a seam
// never shows even with the per-point jitter above nudging things sideways.
const STAMP_OVERLAP_RATIO = 0.86;

/**
 * Bakes every path in a world (or the shelf's tower-to-cabin spokes) into one
 * world-bounds-sized `RenderTexture` — same "one GameObject, not thousands of
 * sprites" reasoning as groundBaker.ts, and doubly so here since a path
 * spans clusters rather than sitting inside one.
 *
 * Batch 1 stamped round dirt blobs unrotated (fine — a blob has no facing).
 * Batch 2's cobblestone segments are rectangular strips, so they're drawn via
 * a reusable-per-texture-key throwaway `Image` (never added to the display
 * list — `scene.make.image({key}, false)`), rotated to the segment's own
 * `angle` before each `RenderTexture#draw` call: `draw()` given a Game
 * Object renders it with its *own* transform (rotation/scale/tint) but the
 * call's (x, y) override its position — see Phaser's
 * `DynamicTexture#batchGameObject`, which is the one thing `drawFrame()`
 * (batch 1's tool, frame-index + position only) can't do.
 */
export function bakePaths(
	scene: Phaser.Scene,
	bounds: WorldBounds,
	segments: readonly PathSegment[],
): Phaser.GameObjects.RenderTexture {
	const width = bounds.maxX - bounds.minX;
	const height = bounds.maxY - bounds.minY;
	const rt = scene.add.renderTexture(
		bounds.minX + width / 2,
		bounds.minY + height / 2,
		width,
		height,
	);

	const stampImages = new Map<string, Phaser.GameObjects.Image>();
	const getStampImage = (key: string): Phaser.GameObjects.Image => {
		let image = stampImages.get(key);
		if (!image) {
			image = scene.make.image({ key }, false);
			stampImages.set(key, image);
		}
		return image;
	};
	const stampWidth = (key: string): number =>
		(scene.textures.get(key).getSourceImage() as { width: number }).width;
	const spacing = stampWidth(pathStampKey(0)) * STAMP_OVERLAP_RATIO;

	for (const segment of segments) {
		const seed = hashStringSeed(segment.id);
		const rand = mulberry32(seed);
		const points = stampPointsAlongSegment(segment.from, segment.to, spacing, {
			jitterAmount: STAMP_JITTER_PX,
			jitterSeed: seed,
		});
		for (const point of points) {
			const key = pathStampKey(Math.floor(rand() * PATH_STAMP_COUNT));
			const image = getStampImage(key);
			image.setRotation(point.angle);
			rt.draw(image, point.x - bounds.minX, point.y - bounds.minY);
		}
	}

	for (const image of stampImages.values()) image.destroy();
	return rt;
}
